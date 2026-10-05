# PRD: StudyBuddy, a Telegram tutor that remembers you

**Status:** Draft v1 | **Event:** Walrus Memory Chatbot Session | **Owner:** you

## 1. Overview

StudyBuddy is a Telegram tutoring bot for students (exam prep, school subjects, self-learners). It uses **Walrus Memory** to remember each student's goals, weak spots, learning style, and past mistakes across sessions and devices, so every conversation picks up where the last one left off.

**Problem:** Generic chatbots tutor everyone the same way and forget everything between chats. Students re-explain their exam date, level, and struggles every time, and the bot repeats explanations that already failed.

**Solution:** Persistent, per-student memory that is recalled before each reply and written after it, so explanations adapt over time.

## 2. Goals and non-goals

**Goals**

1. Memory visibly changes bot behaviour (not decorative).
2. 3+ real users, each with 10+ stored memories, over at least 3 to 4 days.
3. Runs on a non-Anthropic/OpenAI model (qualifies for the Open and Alternative Models prize).
4. Public repo that someone can clone and run in under 15 minutes.
5. Honest before/after evidence for the article.

**Non-goals:** payments, a web UI, group chats, voice, multi-language tutoring, a full curriculum.

## 3. Users

| Persona | Description | Memory that matters |
| --- | --- | --- |
| Exam-prep student | WAEC/JAMB/SAT/uni finals, has a date | Exam date, weak topics, progress |
| Self-learner | Learning coding/maths on the side | Level, goals, preferred style |
| Struggling student | Needs patient, example-first help | Past misconceptions, what explanations worked |

Target: 3 to 5 testers (friends, classmates, hackathon attendees), ideally using both phone and desktop Telegram.

## 4. User stories

- As a student, I don't repeat my exam date, subject, or level every session.
- As a student, the bot remembers which explanation style worked for me.
- As a student, the bot brings up a topic I got wrong last week and quizzes me on it.
- As a student, I can see everything the bot knows about me (`/memory`).
- As a student, I can delete memories (`/forget`) or pause memory (`/nomemory`).
- As the builder, I can run the same script with memory on and off to produce before/after evidence.

## 5. Functional requirements

### 5.1 Chat

- FR1: Free-text tutoring conversation in Telegram (long polling for dev, webhook for prod).
- FR2: Responses stay under about 250 words by default, with examples, and end with a check-for-understanding question where appropriate.
- FR3: Per-user short-term history (last N turns) held in a local store, separate from long-term memory.

### 5.2 Memory (core)

- FR4: **Identity and isolation (per the docs' multi-tenant cookbook).** The bot operator holds **one MemWalAccount and one delegate key** (server-side env vars only, never the owner key). Each Telegram user gets a **namespace** derived on the server from the verified Telegram user ID: `studybuddy-tg-{telegramUserId}`. Same Telegram ID on any device maps to the same namespace. The namespace is never taken from user input.
  - Caveat from the docs: a namespace is a data-organisation boundary, **not** a security boundary. The delegate key can read every namespace, so isolation depends on our server code. Add a test that user A can never recall user B's memories.
  - Namespaces must be stable: never include timestamps or session IDs.
- FR5: **Recall before reply.** Take the latest message (plus a short rewrite of context if needed), query memory, keep the top K (start with 5 to 8) above a relevance threshold, and inject them into the system prompt under "What you know about this student."
- FR6: **Write after reply.** Two strategies, A/B tested during the build:
  - **A (default): Walrus `analyze`.** Send a compact summary of the exchange (the student's message plus the bot's key points) to `memwal.analyze`, which extracts facts and stores each as a separate memory. This keeps extraction independent of the chat model.
  - **B (fallback): own extraction.** Our LLM returns JSON facts that we store with `remember`. Use it if `analyze` output is too noisy or too sparse, and record the comparison for the article.
- FR7: **Deduplication.** Before storing, recall similar memories and skip near-duplicates, or store an update ("Now says exam is on the 20th, previously the 14th").
- FR8: **Memory types** (tag in the text or metadata, depending on what the SDK supports):
  - `goal` (exam, target grade, date)
  - `profile` (level, school, subject list)
  - `weakness` (specific misconceptions, repeated errors)
  - `style` (prefers analogies, short answers, step-by-step)
  - `progress` (topics mastered, quiz results)
  - `event` (notable session moments)
- FR9: **Do not store:** secrets, passwords, contact details, or raw transcripts. Store distilled facts only.
- FR10: **Proactive recall.** On `/start` or the first message after 12+ hours, the bot greets with a relevant callback ("Last time we were on quadratic equations. Want a quick quiz on that?").

### 5.3 Commands

| Command | Behaviour |
| --- | --- |
| `/start` | Onboard, explain memory, set expectations |
| `/memory` | List what the bot remembers about the user (grouped by type) |
| `/forget` | Delete all memories after a confirmation step |
| `/forget <keyword>` | Delete matching memories if the SDK supports it, otherwise explain limits |
| `/nomemory` | Toggle memory off/on (no recall, no writes). Used for the before/after test |
| `/quiz` | Quiz from stored weaknesses and progress |
| `/help` | Command list |

### 5.4 Model layer

- FR11: Provider-agnostic LLM interface (`chat(messages) -> text`, `extract(text) -> facts[]`).
- FR12: Default provider **Gemini** (free tier) or **Llama via Groq/OpenRouter**. Provider chosen by env var. Document which one was used and any friction.
- FR13: Extraction output is JSON, validated, with a retry on malformed output. Open models are less reliable at this, so log failures (good bug-report material).

## 6. Architecture

```
Telegram user
    |
 Bot server (Node/TypeScript + grammY, assumed; confirm SDK language)
    |-- Session store (SQLite): recent turns, memory on/off flag, last-seen
    |-- Memory adapter  --> Walrus Memory (MemWal SDK)
    |-- LLM adapter     --> Gemini / Groq / OpenRouter
```

**Request flow**

1. Message arrives, so load the user's flag and recent turns.
2. If memory is on, recall top K from Walrus Memory.
3. Build prompt (system prompt + recalled memories + recent turns + message).
4. Call the LLM and send the reply.
5. Asynchronously run extraction, dedupe against existing memories, and write new ones.
6. Log latency, recalled memories, and written memories (for evidence).

**SDK facts confirmed from the docs** (`@mysten-incubation/memwal`, Node 18+ or Bun):

- Setup: create the account ID and delegate key once at memory.walrus.xyz. Relayers: production (mainnet) `https://relayer.memory.walrus.xyz`, staging (testnet) `https://relayer-staging.memory.walrus.xyz`. Use staging while developing.
- `MemWal.create({ key, accountId, serverUrl, namespace })`
- `remember(text, namespace)` returns a job, because encryption, upload, and indexing happen in the background. `waitForRememberJob(job_id)` blocks until it is indexed.
- `recall({ query, namespace, limit })` returns semantic matches.
- `analyze(text)` extracts facts from longer text and stores each as its own memory (returns `job_ids`).
- `restore(namespace, limit)` rebuilds the index from Walrus. `health()` checks the relayer.
- Semantic recall is fuzzy. The docs warn it is not reliable for fetching one authoritative "profile" record (issue #247), so we store many small fact lines instead of one profile blob.

**Memory adapter interface** (all Walrus calls live in one file):

```
recall(userId, query, limit) -> Memory[]
remember(userId, text, { wait? }) -> jobId
analyzeAndStore(userId, text) -> jobIds
listApprox(userId) -> Memory[]    // see gap below
forget(userId)                    // see gap below
```

**Known gaps to design around (document as friction/bug report if confirmed):**

- No list or delete method appears in the SDK pages reviewed. **`/memory`** therefore runs several broad recall queries ("goals", "weak topics", "learning style", "progress") and also reads a local SQLite mirror of what the bot wrote, labelled as such. **`/forget`** is a *logical* forget: bump a version suffix stored locally (`studybuddy-tg-{id}-v2`) so the old namespace is never queried again, and tell the user plainly that data written to Walrus is not physically erased. Re-check the API reference and GitHub for real delete support first.
- `remember` is asynchronous. Writes are fire-and-forget in normal replies. The `/memory` command and the test scripts wait for jobs so results appear immediately.

## 7. Prompts (starter drafts)

**Tutor system prompt (outline):** You are StudyBuddy, a patient tutor. Use the student memories below to personalise. Reference them naturally, do not list them. If a memory conflicts with what the student says now, trust the student and note the change. Never invent memories.

**Extraction prompt (outline):** From this exchange, list durable facts about the student (goals, level, weaknesses, style preferences, progress). One short, self-contained sentence each. Exclude small talk and sensitive data. Return JSON: `[{"type": "...", "text": "..."}]`. Return `[]` if nothing durable.

## 8. Non-functional requirements

- **Latency:** reply in under 6s typical, with recall under about 1.5s. Extraction and writes run off the critical path.
- **Privacy:** per-user isolation, `/forget` works, `/start` discloses what is stored, and API keys live in env vars only. Tell testers their memories may be quoted (anonymised) in the article.
- **Reliability:** if Walrus Memory or the LLM fails, the bot degrades gracefully (replies without memory and tells the user) and logs the error.
- **Reproducibility:** `.env.example`, `README` with setup in 10 steps or fewer, and one command to run.

## 9. Success metrics

| Metric | Target |
| --- | --- |
| Real users | 3 minimum, aim for 5 |
| Memories per user | 10 minimum each, aim for 15 or more |
| Active span | 3 to 4 days minimum |
| Recall hit moments | 3+ documented "it remembered and it mattered" examples |
| Before/after | Same user and same prompts, memory off vs on, side by side |
| Duplicate rate | Under 15% of stored memories |
| Recall relevance | Manually rate 20 recalls, aim for 70% or more useful |

## 10. Evaluation protocol (for the article)

1. **Baseline (Day 1):** each tester runs `/nomemory` and has a scripted conversation (state exam date, weak topic, preferred style, ask a question).
2. **Memory on:** tester uses the bot normally for 3+ days.
3. **Replay (Day 4+):** start a fresh session and ask the same opening question with memory off, then on. Capture both.
4. **Cross-device:** one user switches phone to desktop Telegram and shows continuity.
5. **Evidence:** screenshots of conversations, `/memory` output per user, and exported logs.

## 11. Evidence checklist

- [ ] Screenshots of 3+ users with 10+ memories each (`/memory`)
- [ ] One day-1 vs day-4 conversation pair per user
- [ ] Memory-off vs memory-on replay
- [ ] Cross-device screenshot
- [ ] Log excerpt showing recall and write
- [ ] Short screen recording (optional but strong)

## 12. Deliverables and submission

| Item | Notes |
| --- | --- |
| Public GitHub repo | Open source, README, `.env.example`, setup steps, license |
| Live bot | Telegram handle in the article |
| Article (Medium and/or Inkray) | 500 to 800 words, see structure below |
| X post | Tag @WalrusProtocol, use #WalrusMemory, reply under the session announcement |
| Bug/friction note | Plus a GitHub issue on MystenLabs/MemWal for the Bug Bounty |
| Promo post | In a non-Walrus/Sui community (dev.to, relevant subreddit, dev forum) |
| Form fields | Model/runtime, repo link, friction/improvement idea, article link, X link |

**Article structure:** (1) the problem, written for someone searching "chatbot that remembers users between sessions"; (2) what StudyBuddy does; (3) how Walrus Memory is wired in (what is stored, when recalled, how it shapes replies); (4) before/after with real conversations; (5) what broke; (6) model and runtime used and any friction; (7) try it yourself.

## 13. Timeline

| Day | Work |
| --- | --- |
| 1 | Read the docs and chatbot example, scaffold bot, memory adapter, LLM adapter, basic recall/write |
| 2 | Extraction + dedupe, commands, deploy, invite testers |
| 3 to 5 | Real usage, tune prompts and thresholds, collect evidence, log bugs |
| 6 | Write article, finish README, file GitHub issue, publish, post on X and in the promo community, submit form |

## 14. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Open model returns bad extraction JSON | Strict schema, retry, fall back to a stronger model for extraction only (documented) |
| Noisy or duplicate memories | Dedupe step, "durable facts only" prompt, cap writes per turn (max 3) |
| Irrelevant recall pollutes replies | Relevance threshold, small K, instruct model to ignore unrelated memories |
| Testers not engaged | Recruit 5 so 3 stay active, and send a day-2/3 nudge |
| SDK gaps (list/delete/update) | Document as friction, wrap in adapter, file GitHub issue |
| Free-tier rate limits | Provider fallback via env var, cache, and cap tokens |
| Latency from memory calls | Parallelise recall with history load, write asynchronously |

## 15. Open questions

**Resolved from the docs:** the SDK is TypeScript (Python also exists), so the stack is Node/TypeScript. Keys use one account plus one delegate key with a namespace per user.

**Still open (check the API reference at docs.wal.app/walrus-memory/sdk/api-reference and the GitHub issues):**

1. Is there any list, delete, or update method, or metadata/tags on memories?
2. Does `recall` return relevance scores usable for a threshold?
3. What are the relayer rate limits and typical `remember` latency (index delay)?
4. Which model is primary: Gemini free tier, Groq Llama, or local Ollama?
5. Hosting: Railway, Fly.io, or a small VPS?
6. Staging (testnet) or production (mainnet) relayer for the final deployment?

## 16. Extra evidence the docs suggest for submissions

- Share the MemWalAccount object ID and show it on a Sui explorer (Suiscan or SuiVision) to prove memory is onchain, not just cached.
- Include a live `health()` check output so judges can confirm the relayer is reachable.
- Demonstrate `restore` (rebuild a namespace's index from Walrus) as a resilience moment.