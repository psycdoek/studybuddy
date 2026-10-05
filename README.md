# StudyBuddy

A Telegram tutor bot that remembers each student across sessions and devices using **Walrus Memory**. It recalls goals, exam dates, weak topics and learning style before every reply, and saves new durable facts after.

**Stack:** TypeScript/Node 18+, grammY (Telegram), `@mysten-incubation/memwal` (memory), Gemini (LLM, swappable in `src/llm.ts`), SQLite (short-term chat history only).

## How memory is used
- **Isolation:** one Walrus Memory account + delegate key on the server; one namespace per Telegram user (`studybuddy-tg-<userId>`), derived server-side. A namespace is a data boundary, not a security boundary, so never take it from user input.
- **Recall (before reply):** the student's message is the query; top 6 results are injected into the system prompt.
- **Write (after reply, non-blocking):** `EXTRACTOR=analyze` sends the exchange to Walrus `analyze` (it extracts facts and stores each as its own memory). `EXTRACTOR=llm` uses our own Gemini extraction and `remember`.
- **Returning-user greeting:** after 12+ hours away, the prompt asks the model to open with a specific callback.
- **Failure mode:** if recall fails, the bot replies without memory.

## Commands
`/start` `/help` `/memory` `/forget` (then `/forget confirm`) `/nomemory` (toggle, for before/after tests) `/quiz`

Send the bot an image, PDF, plain text file, or CSV as a Telegram attachment. Add a caption to ask a specific question. Text file contents are processed for the current reply but are not added to chat history; only the file name is kept there. Uploads are limited to 15 MB (text files to 1 MB).

## Setup
1. Create a bot with @BotFather and copy the token.
2. Create a Walrus Memory account + **delegate key** at https://memory.walrus.xyz (not the owner key).
3. Get a Gemini key from Google AI Studio.
4. `cp .env.example .env` and fill it in. Keep `MEMWAL_SERVER_URL` on staging while developing.
5. `npm install`
6. `npm run build` to compile. `npm run smoke` checks the Walrus relayer and namespace isolation; it writes two uniquely tagged test memories that remain in your configured Walrus environment.
7. `npm run dev` and message your bot.

## Deploy
- **Webhook mode** (Render free, etc.): set `MODE=webhook`, `PUBLIC_URL=https://your-app.example.com`, `PORT`. Start command: `npm start`. Free instances may sleep and may not keep a disk, so SQLite history can reset; long-term memory lives in Walrus and is unaffected.
- **VM** (e.g. Oracle Always Free): use `MODE=polling`, run under `pm2` or systemd, and keep `DB_PATH` on persistent disk.

## Known limitations / friction (fill in as you test)
- No list/delete method found in the SDK docs reviewed: `/memory` uses broad recall queries; `/forget` switches to a new namespace (old data remains on Walrus).
- `remember` is asynchronous (job + index delay); `smoke` measures it.
- Recall result field names were not documented where I looked; `textOf()` in `src/memory.ts` guesses them.
- Add your own findings here (model quirks, latency, noisy `analyze` output).

## Before/after test
Same user, same questions: `/nomemory` then ask; `/nomemory` again, new session next day, ask again. Capture both.
