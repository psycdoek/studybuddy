import { MemWal } from "@mysten-incubation/memwal";
import { bumpVersion, getUser, listWritten, logWritten } from "./db.js";
import { extractFacts } from "./llm.js";


const SERVER_URL = process.env.MEMWAL_SERVER_URL ?? "https://relayer-staging.memory.walrus.xyz";
const PREFIX = process.env.MEMWAL_NS_PREFIX ?? "studybuddy-tg";
const EXTRACTOR = process.env.EXTRACTOR ?? "analyze";
const MAX_WRITES_PER_TURN = 3;

const clients = new Map<string, MemWal>();

export function namespaceFor(userId: string, version = 1): string {
  return `${PREFIX}-${userId}${version > 1 ? `-v${version}` : ""}`.toLowerCase();
}

function clientFor(ns: string): MemWal {
  let c = clients.get(ns);
  if (!c) {
    c = MemWal.create({
      key: (process.env.MEMWAL_PRIVATE_KEY ?? process.env.MEMWAL_KEY)!,
      accountId: process.env.MEMWAL_ACCOUNT_ID!,
      serverUrl: SERVER_URL,
      namespace: ns,
    });
    clients.set(ns, c);
  }
  return c;
}

/** Result shape isn't documented in the pages I read; be defensive. Run `npm run smoke` to see the real shape. */
export function textOf(r: any): string {
  return String(r?.text ?? r?.content ?? r?.memory ?? r?.plaintext ?? JSON.stringify(r));
}

export async function health() {
  return clientFor(namespaceFor("healthcheck")).health();
}

export async function recallFor(userId: string, query: string, limit = 6): Promise<string[]> {
  const ns = namespaceFor(userId, getUser(userId).ns_version);
  const res: any = await clientFor(ns).recall({ query, limit });
  return (res?.results ?? []).map(textOf);
}

export async function remember(userId: string, text: string, wait = false) {
  const ns = namespaceFor(userId, getUser(userId).ns_version);
  const c: any = clientFor(ns);
  const job = await c.remember(text);
  if (wait && job?.job_id) await c.waitForRememberJob(job.job_id);
  logWritten(userId, getUser(userId).ns_version, text);
  return job;
}

/** Called after each reply (fire-and-forget). Stores durable facts about the student. */
export async function storeExchange(userId: string, studentMsg: string, tutorReply: string) {
  if (studentMsg.trim().length < 15) return; // skip trivial messages
  const exchange = `Student: ${studentMsg}\nTutor: ${tutorReply.slice(0, 300)}`;
  const user = getUser(userId);
  const ns = namespaceFor(userId, user.ns_version);

  if (EXTRACTOR === "llm") {
    const known = new Set(listWritten(userId, user.ns_version).map((t) => t.toLowerCase()));
    const facts = (await extractFacts(exchange)).filter((f) => !known.has(f.toLowerCase())).slice(0, MAX_WRITES_PER_TURN);
    for (const f of facts) await remember(userId, f);
    return;
  }
  // Strategy A: let Walrus Memory extract the facts and store each as its own memory.
  const a: any = await (clientFor(ns) as any).analyze(exchange);
  // Record only operational metadata locally; never mirror the student's transcript into SQLite.
  logWritten(userId, user.ns_version, `[analyzed] ${a?.job_ids?.length ?? "?"} job(s)`);
}

/** Approximate listing: several broad recall queries, deduped. The SDK pages reviewed show no list method. */
export async function listApprox(userId: string): Promise<string[]> {
  const queries = ["goals and exam dates", "weak topics and mistakes", "learning style preferences", "progress and mastered topics", "level and subjects"];
  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        return await recallFor(userId, q, 8);
      } catch (e) {
        console.warn("[listApprox]", (e as Error).message);
        return [];
      }
    })
  );
  const seen = new Set<string>();
  for (const items of results) for (const t of items) seen.add(t);
  return [...seen];
}

/** Logical forget: switch to a fresh namespace. Data already written to Walrus is NOT physically erased. */
export function forgetAll(userId: string) {
  bumpVersion(userId);
}
