# StudyBuddy

StudyBuddy is an open-source Telegram tutor that answers study questions and can use long-term memory to tailor help to each student. It uses Gemini for responses, Walrus Memory for optional long-term memory, and SQLite for local conversation history and settings.

Students can chat by text, send supported images and documents, review approximate recalled memories, quiz weak topics, and pause or reset memory.

## Features

- Telegram bot built with TypeScript and grammY.
- Gemini-powered tutoring, with the model configurable through `GEMINI_MODEL`.
- Optional per-user Walrus Memory namespaces, derived server-side from Telegram user IDs.
- SQLite storage for user settings, recent conversation context, and local memory metadata.
- Photo and document input: JPEG, PNG, WebP, HEIC, HEIF, PDF, TXT, CSV, and Markdown files. File limit: 15 MB; text files: 1 MB.
- Polling for local development or webhook mode for hosting.

## Requirements

- Node.js 22 or later.
- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/).
- For long-term memory, a Walrus Memory account ID and registered **delegate private key** from the [Walrus Memory dashboard](https://memory.walrus.xyz). Do not use an owner key.

## Run locally

1. Clone this repository and install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell), then fill in your Telegram and Gemini credentials. Add Walrus credentials to enable long-term memory. `.env.local`, when present, takes precedence over `.env`.

3. Build and start the development bot:

   ```sh
   npm run build
   npm run dev
   ```

4. Open your bot in Telegram and send `/start`.

The development command uses long polling by default. `npm start` runs the compiled application after `npm run build`.

## Configuration

See `.env.example` for all settings. The main options are:

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token. |
| `GEMINI_API_KEY` | Gemini API key. |
| `GEMINI_MODEL` | Gemini model ID; defaults to `gemini-2.5-flash`. Availability depends on your Google AI account. |
| `MEMWAL_PRIVATE_KEY` | Walrus delegate private key; required for long-term memory. |
| `MEMWAL_ACCOUNT_ID` | Walrus account that registered the delegate key. |
| `MEMWAL_SERVER_URL` | Walrus relayer URL. The example uses staging. The account, delegate key, and relayer must use the same network. |
| `EXTRACTOR` | `analyze` (Walrus extracts facts) or `llm` (Gemini extracts facts). |
| `MODE` | `polling` or `webhook`. |
| `DB_PATH` | SQLite database location; defaults to `studybuddy.db`. |

Keep `.env` and `.env.local` private. They are ignored by Git. Never commit API keys, delegate keys, or the SQLite database.

## Telegram commands and uploads

- `/start` — introduction and setup prompt.
- `/help` — command list.
- `/memory` — approximate list of memories found by several recall queries; it may not show every stored fact.
- `/forget` — ask to start fresh; confirm with `/forget confirm`.
- `/nomemory` — toggle Walrus recall and writes on or off.
- `/quiz` — start a quiz, targeting recalled weak topics when available.

Send an image, PDF, TXT, CSV, or Markdown document as an attachment. A caption can ask a question about it. The bot sends supported images and PDFs to Gemini. Text file contents are included in the current Gemini request, but the file contents themselves are not saved in local chat history.

## Memory behavior and limitations

- With memory enabled, StudyBuddy recalls up to six matches before replying and asynchronously asks the configured extractor to save durable facts after the reply.
- User namespaces are organizational boundaries, not security boundaries. The server holds a delegate key that can access namespaces; never accept a namespace from user input.
- `/nomemory` pauses Walrus recall and writes. The bot still sends the current message to Gemini and stores chat history locally.
- `/forget confirm` switches to a new namespace. It does **not** physically erase data already stored in Walrus, and it does not delete the local SQLite conversation history.
- `/memory` uses broad semantic recall queries because it is not a complete listing of the Walrus namespace.
- SQLite stores conversation messages on the bot host. The latest ten messages are supplied to Gemini as context; older rows are currently retained in the database until it is removed manually.
- Telegram user IDs are written to the application log. Avoid sharing sensitive personal information with the bot.
- Photo/PDF uploads and the text of each user message are sent to Gemini to generate a response. With Walrus memory enabled, the student message and a portion of the tutor reply are also sent to the configured memory extractor. Review the Gemini and Walrus terms before inviting other people to use your deployment.

The smoke command writes two uniquely tagged test memories to the configured Walrus environment. They remain there after the command finishes.

## Webhook deployment

Set `MODE=webhook`, `PUBLIC_URL` to your public HTTPS URL without a trailing slash, and `PORT` if your host requires a specific port. Build with `npm run build`, then run `npm start`. Use persistent storage for `DB_PATH` if local conversation history should survive restarts.

## Development

```sh
npm run dev       # watch and run the TypeScript bot
npm run build     # type-check and compile to dist/
npm run smoke     # write/recall Walrus test memories and check namespace isolation
```

There is currently no automated test suite. The smoke command contacts Walrus and writes persistent test data; run it only when intended.

Bug reports and pull requests are welcome. Please do not include credentials, private conversations, or user memory data in issues.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
