import "./env.js";
import { createServer } from "node:http";
import { Bot, webhookCallback } from "grammy";
import { addTurn, getUser, recentTurns, setMemoryOn, touch } from "./db.js";
import { chat } from "./llm.js";
import type { GeminiAttachment } from "./llm.js";
import { forgetAll, health, listApprox, recallFor, storeExchange } from "./memory.js";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const TWELVE_HOURS = 12 * 60 * 60 * 1000;
const pendingForget = new Set<string>();
const MAX_TELEGRAM_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;

function systemPrompt(memories: string[], returning: boolean): string {
    const mem = memories.length
        ? memories.map((m) => `- ${m}`).join("\n")
        : "(nothing remembered yet)";
    return [
        "You are StudyBuddy, a patient, encouraging tutor on Telegram.",
        "Keep replies under ~200 words, plain text (no markdown), use concrete examples, and end with one short check-for-understanding question when teaching.",
        "",
        "What you remember about this student (from past sessions):",
        mem,
        "",
        "Use these memories naturally to personalise help (their exam date, weak spots, preferred style). Don't recite them as a list.",
        "If a memory conflicts with what the student says now, trust the student. Never invent memories.",
        returning && memories.length
            ? "The student is returning after a break: open with one brief, specific callback to something you remember (e.g. a weak topic or upcoming exam) and offer to continue."
            : "",
    ].join("\n");
}

async function send(ctx: any, text: string) {
    let remaining = text.trim();
    while (remaining.length > 0) {
        if (remaining.length <= 4000) {
            await ctx.reply(remaining);
            break;
        }
        let splitAt = remaining.lastIndexOf("\n", 4000);
        if (splitAt < 2000) splitAt = remaining.lastIndexOf(" ", 4000);
        if (splitAt < 2000) splitAt = 4000;
        await ctx.reply(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
}

bot.command("start", async (ctx) => {
    getUser(String(ctx.from!.id));
    await send(
        ctx,
        "Hi, I'm StudyBuddy, your study tutor. I remember your goals, weak topics and how you like to learn, across sessions and devices, using Walrus Memory.\n\n" +
        "Tell me what you're studying and when your exam is.\n\n" +
        "Commands: /memory (see what I remember), /forget (start fresh), /nomemory (toggle memory on/off), /quiz, /help"
    );
});

bot.command("help", (ctx) =>
    send(ctx, "/memory - what I remember about you\n/forget - clear my memory of you\n/nomemory - toggle memory on/off\n/quiz - quiz me on my weak topics\n/start - intro")
);

bot.command("nomemory", async (ctx) => {
    const id = String(ctx.from!.id);
    const u = getUser(id);
    const on = !u.memory_on;
    setMemoryOn(id, on);
    await send(ctx, on ? "Memory is ON. I'll recall and save facts about you." : "Memory is OFF. I won't recall or save anything until you send /nomemory again.");
});

bot.command("memory", async (ctx) => {
    const id = String(ctx.from!.id);
    if (!getUser(id).memory_on) return send(ctx, "Memory is currently OFF (/nomemory to turn on).");
    await ctx.replyWithChatAction("typing");
    const items = await listApprox(id);
    if (!items.length) return send(ctx, "I don't have any memories of you yet. Tell me about your studies!");
    await send(ctx, `Here's what I remember (${items.length}):\n\n` + items.map((m, i) => `${i + 1}. ${m}`).join("\n"));
});

bot.command("forget", async (ctx) => {
    const id = String(ctx.from!.id);
    if (ctx.match?.trim().toLowerCase() === "confirm" && pendingForget.has(id)) {
        pendingForget.delete(id);
        forgetAll(id);
        return send(ctx, "Done. I've started a fresh memory for you. (Note: data already stored on Walrus isn't physically erased; I just won't use it anymore.)");
    }
    pendingForget.add(id);
    await send(ctx, "This clears everything I remember about you. Send /forget confirm to proceed.");
});

bot.command("quiz", async (ctx) => {
    const id = String(ctx.from!.id);
    const mems = getUser(id).memory_on ? await recallFor(id, "weak topics mistakes and misconceptions", 6).catch(() => []) : [];
    const prompt = mems.length
        ? "Give me a short 3-question quiz targeting my weak topics. Ask one question at a time, starting with the first."
        : "Give me a short quiz on whatever we've been studying. Ask one question at a time, starting with the first.";
    await handle(ctx, id, prompt);
});

async function downloadTelegramFile(ctx: any, fileId: string): Promise<Buffer> {
    const info = await ctx.api.getFile(fileId);
    if (!info.file_path) throw new Error("Telegram did not provide a download path for that file");
    if (info.file_size && info.file_size > MAX_TELEGRAM_FILE_BYTES) {
        throw new Error("That file is too large. Please upload a file smaller than 15 MB.");
    }
    const filePath = info.file_path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Telegram file download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_TELEGRAM_FILE_BYTES) {
        throw new Error("That file is too large. Please upload a file smaller than 15 MB.");
    }
    return bytes;
}

async function handle(ctx: any, id: string, text: string, attachments: GeminiAttachment[] = [], historyText = text) {
    const user = getUser(id);
    const returning = user.last_seen > 0 && Date.now() - user.last_seen > TWELVE_HOURS;
    await ctx.replyWithChatAction("typing");

    let memories: string[] = [];
    if (user.memory_on) {
        try {
            memories = await recallFor(id, text, 6);
        } catch (e) {
            console.warn("[recall failed, replying without memory]", (e as Error).message);
        }
    }
    console.log(`[user ${id}] memory=${user.memory_on ? "on" : "off"} recalled=${memories.length}`);

    let reply: string;
    try {
        reply = await chat(systemPrompt(memories, returning), recentTurns(id, 10), text, attachments);
    } catch (e) {
        console.error("[llm error]", e);
        return send(ctx, "Sorry, my brain hiccuped. Please try again in a moment.");
    }
    addTurn(id, "user", historyText);
    addTurn(id, "model", reply);
    touch(id);
    await send(ctx, reply);

    if (user.memory_on) {
        storeExchange(id, historyText, reply).catch((e) => console.warn("[store failed]", (e as Error).message));
    }
}

bot.on("message:text", (ctx) => handle(ctx, String(ctx.from.id), ctx.message.text));
bot.on("message:photo", async (ctx) => {
    try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        if (!photo) throw new Error("Telegram did not include an image file");
        const bytes = await downloadTelegramFile(ctx, photo.file_id);
        const attachment: GeminiAttachment = { mimeType: "image/jpeg", data: bytes.toString("base64") };
        const caption = ctx.message.caption?.trim();
        await handle(ctx, String(ctx.from.id), caption || "Please describe this image and help me understand it.", [attachment], caption || "[Sent an image]");
    } catch (e) {
        console.error("[image upload failed]", e);
        await send(ctx, (e as Error).message || "I couldn't read that image. Please try another one.");
    }
});

bot.on("message:document", async (ctx) => {
    try {
        const doc = ctx.message.document;
        const name = doc.file_name || "uploaded file";
        const mimeType = (doc.mime_type || "").toLowerCase();
        const ext = name.toLowerCase().split(".").pop();
        const bytes = await downloadTelegramFile(ctx, doc.file_id);
        const caption = ctx.message.caption?.trim();

        if (mimeType === "text/plain" || mimeType === "text/csv" || ["txt", "csv", "md"].includes(ext ?? "")) {
            if (bytes.length > MAX_TEXT_FILE_BYTES) throw new Error("That text file is too large. Please upload one smaller than 1 MB.");
            const fileText = bytes.toString("utf8");
            const request = `${caption || "Please help me understand this file."}\n\nFile: ${name}\nFile contents:\n${fileText}`;
            await handle(ctx, String(ctx.from.id), request, [], `${caption || "Please review this file."} [Attached text file: ${name}]`);
            return;
        }

        const supportedImages = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
        const supported = mimeType === "application/pdf" || supportedImages.has(mimeType) || (!mimeType && ext === "pdf");
        if (!supported) throw new Error("I can read images, PDFs, and text/CSV files. Please convert this file to one of those formats and send it again.");
        const attachment: GeminiAttachment = { mimeType: mimeType || "application/pdf", data: bytes.toString("base64") };
        await handle(ctx, String(ctx.from.id), caption || `Please read and help me with the attached file: ${name}`, [attachment], caption || `[Sent file: ${name}]`);
    } catch (e) {
        console.error("[document upload failed]", e);
        await send(ctx, (e as Error).message || "I couldn't read that file. Please try another one.");
    }
});
bot.catch((err) => console.error("[bot error]", err.error));

async function main() {
    try {
        await health();
        console.log("Walrus Memory relayer: healthy");
    } catch (e) {
        console.warn("Walrus Memory health check failed:", (e as Error).message);
    }
    if ((process.env.MODE ?? "polling") === "webhook") {
        const handler = webhookCallback(bot, "http");
        const server = createServer(async (req, res) => {
            if (req.url === "/webhook" && req.method === "POST") return handler(req, res);
            res.writeHead(200).end("StudyBuddy OK");
        });
        server.listen(Number(process.env.PORT ?? 3000));
        await bot.api.setWebhook(`${process.env.PUBLIC_URL}/webhook`);
        console.log("Webhook mode on", process.env.PUBLIC_URL);
    } else {
        await bot.api.deleteWebhook();
        console.log("StudyBuddy running (long polling)");
        await bot.start();
    }
}
main();
