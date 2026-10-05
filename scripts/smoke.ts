import "../src/env.js";
import { health, namespaceFor, recallFor, remember } from "../src/memory.js";

const required = ["MEMWAL_PRIVATE_KEY", "MEMWAL_ACCOUNT_ID"] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Set ${missing.join(" and ")} in .env before running the Walrus smoke check`);

const tag = `studybuddy-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userA = `${tag}-a`;
const userB = `${tag}-b`;
const secretA = `Private smoke test fact ${tag}: student A studies astronomy`;
const secretB = `Private smoke test fact ${tag}: student B studies botany`;

console.log("Checking Walrus relayer health...");
await health();
console.log("Relayer is healthy.");
console.log("Writing two temporary memories (this creates data in your configured Walrus environment)...");
await remember(userA, secretA, true);
await remember(userB, secretB, true);
const [aResults, bResults] = await Promise.all([
  recallFor(userA, tag, 10),
  recallFor(userB, tag, 10),
]);
console.log("Namespace A:", namespaceFor(userA));
console.log("Namespace B:", namespaceFor(userB));
console.log("Recall A:", JSON.stringify(aResults));
console.log("Recall B:", JSON.stringify(bResults));
if (aResults.some((text) => text.includes(secretB)) || bResults.some((text) => text.includes(secretA))) {
  throw new Error("Namespace isolation check failed: a user's recall included the other user's fact");
}
console.log("Smoke check passed. The uniquely tagged test memories remain in Walrus.");
