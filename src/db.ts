import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export type TurnRole = "user" | "model";
export interface UserState { user_id: string; memory_on: number; ns_version: number; last_seen: number; }
export interface Turn { role: TurnRole; content: string; }

const dbPath = resolve(process.env.DB_PATH ?? "studybuddy.db");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    memory_on INTEGER NOT NULL DEFAULT 1,
    ns_version INTEGER NOT NULL DEFAULT 1,
    last_seen INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS turns_user_id_id ON turns(user_id, id);
  CREATE TABLE IF NOT EXISTS written_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ns_version INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, ns_version, text)
  );
`);

const ensureUser = db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)");
const selectUser = db.prepare("SELECT user_id, memory_on, ns_version, last_seen FROM users WHERE user_id = ?");
export function getUser(userId: string): UserState {
  ensureUser.run(userId);
  return selectUser.get(userId) as UserState;
}
export function setMemoryOn(userId: string, on: boolean): void {
  getUser(userId);
  db.prepare("UPDATE users SET memory_on = ? WHERE user_id = ?").run(on ? 1 : 0, userId);
}
export function bumpVersion(userId: string): number {
  getUser(userId);
  db.prepare("UPDATE users SET ns_version = ns_version + 1 WHERE user_id = ?").run(userId);
  return getUser(userId).ns_version;
}
export function touch(userId: string): void {
  getUser(userId);
  db.prepare("UPDATE users SET last_seen = ? WHERE user_id = ?").run(Date.now(), userId);
}
export function addTurn(userId: string, role: TurnRole, content: string): void {
  getUser(userId);
  db.prepare("INSERT INTO turns (user_id, role, content) VALUES (?, ?, ?)").run(userId, role, content);
}
export function recentTurns(userId: string, limit = 10): Turn[] {
  const rows = db.prepare("SELECT role, content FROM turns WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, Math.max(0, Math.floor(limit))) as Turn[];
  return rows.reverse();
}
export function logWritten(userId: string, version: number, text: string): void {
  db.prepare("INSERT OR IGNORE INTO written_memories (user_id, ns_version, text) VALUES (?, ?, ?)").run(userId, version, text);
}
export function listWritten(userId: string, version: number): string[] {
  return (db.prepare("SELECT text FROM written_memories WHERE user_id = ? AND ns_version = ? ORDER BY id").all(userId, version) as { text: string }[]).map((row) => row.text);
}
