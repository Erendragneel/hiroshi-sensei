# Hiroshi sensei — a personal conversation companion

An original browser game for relaxed conversation with one companion, inspired by the conversational approach of Amiko. The delivery follows Language Miner: a simple installable web app with bundled practice content. Hiroshi sensei is a separate project; Language Miner was only inspected and was not changed.

## Open the game

On your phone, open [Hiroshi sensei](https://erendragneel.github.io/hiroshi-sensei/) in Safari or Chrome and tap **Install app** at the top of the game. The app shows the browser's install prompt when available, or the steps for adding it to your home screen. The GitHub Pages version opens without a ChatGPT sign-in. iPhone installation uses Safari → Share → Add to Home Screen.

The phone version includes guided conversations, lessons, homework, and saved progress. AI conversations on the phone require a separately configured hosted AI connection; the computer's local model does not move onto the phone. Each device has its own save, with export/restore available in Settings.

Source code is published in the [Erendragneel/hiroshi-sensei GitHub repository](https://github.com/Erendragneel/hiroshi-sensei). Personal saves, exported backups, API secrets, and the downloaded model/runtime are excluded from the repository. If you previously played at the [private Sites address](https://koa-personal-companion.elijio-villa.chatgpt.site/play/), export a backup there and restore it in Settings at the new GitHub address to transfer your progress.

## GitHub Pages deployment

GitHub Pages uses `.github/workflows/pages.yml` to validate and publish the game on pushes to `main`, with a manual run option in GitHub Actions. Run `npm run build:pages` to package only the public game assets into `dist/pages/` locally. The workflow publishes that folder to `https://erendragneel.github.io/hiroshi-sensei/`. The repository is public with the owner's approval, matching Language Miner's hosting approach while keeping Hiroshi's app identity separate.

GitHub Pages serves guided conversations, lessons, homework, and offline practice. It cannot run this app's AI server. The Pages package explicitly disables AI API requests and uses its own installation link. The local and Sites builds retain their existing AI backend configuration.

Hiroshi sensei has a separate manifest identity at `/hiroshi-sensei/`, its own H/star icons, save key, backup identifier, and service-worker cache. Its scope and cache cleanup do not include `/language-miner/`. The installed app name stays Hiroshi sensei when a companion nickname changes. Existing version-1 Hiroshi backups remain compatible. Moving between the private Sites address and GitHub Pages requires exporting and restoring a backup because browser data belongs to each origin.

## Local AI on Windows

On this Windows computer, double-click **Start Koa.cmd**. It starts the local AI and game quietly, then opens the game. **Stop Koa.cmd** closes the background processes started by the launcher. Node.js 22 or newer is needed; the launcher also finds Codex's bundled Node runtime when available.

The local model download is about 2.5 GB. The local AI uses the portable llama.cpp CPU runtime and Qwen3 4B Q4_K_M. They are downloaded from their official publishers and verified with pinned SHA-256 hashes by `Setup-Local-AI.ps1`. Model/runtime files live under `%LOCALAPPDATA%\Koa`, outside this OneDrive project. No administrator installation, API key, or API billing is needed for this route. It is a small local model, with lower capability and reliability than the assistant in this Codex chat.

For terminal use, run `node server.mjs` in this folder and open <http://127.0.0.1:4317/>. This starts guided mode unless a local AI endpoint or OpenAI key is configured; the launcher handles local AI automatically. Both servers bind only to this computer, on ports 4317 (game) and 4318 (AI). No npm dependencies or build are needed for the local app. The hosted version is packaged separately in `hosted/` using the supported Sites starter and currently offers guided scenes unless an OpenAI secret is configured for hosting.

## What works

- One original red-haired anime teacher illustration, named **Hiroshi sensei**, renameable in Preferences.
- Four guided everyday scenes: café, walk, home, and travel. Known Japanese or English phrases continue a scene; suggestions fill the box for the user to review and send. These scenes are explicitly scripted and do not impersonate open-ended AI.
- Japanese pronunciation readings and English translations, English guided practice, and browser read-aloud when a suitable voice is available. Generated local AI pronunciation readings are suppressed after observed quality issues; guided readings remain available.
- Optional browser dictation, which fills the message box without submitting automatically. Browser support and installed voices vary.
- A phrasebook, a notebook of up to 12 personal notes, per-scene saved conversations, a small daily practice target, and backup export/restore.
- **Learn with Hiroshi sensei:** six beginner Japanese lessons with English explanations, pronunciation examples, guided practice, and four-question homework assignments due the next day. Lessons and homework work offline. Drafts save as you type; submitted answers receive specific feedback and model answers. Revisions preserve the first submission, latest score, and up to 12 saved attempts.
- **Lesson help:** ask the same companion to explain a lesson or give a homework hint in a separate teaching conversation. This uses the existing local AI on this computer (or the optional configured hosted AI). It does not change social chat into a lesson or invent assignment marks. AI latency depends on computer load; authored lessons and homework checks respond immediately. Local AI generates the explanation, with three authored English questions offered afterward.
- Responsive desktop and mobile layouts, keyboard-accessible dialogs and controls, reduced-motion support, and offline guided practice after a successful first visit.

## Live AI status

**On-device AI is available on this computer.** The server verifies runtime readiness before reporting it ready. It uses schema-constrained replies, bounded recent context, optional corrections, timeouts, and safe error handling. Japanese, English, Spanish, and Korean can be selected; beginner Japanese and English are the primary guided practice languages. On-device replies use the six most recent notebook notes, shortened for the small model's context. The local model does not silently fall back to a paid API.

For faster local conversations, the model generates the answer and its English translation rather than three extra suggested replies. The three follow-up buttons are authored practice phrases in the selected language. Local social conversation includes up to six recent turns and approximately 2,000 characters, while retaining the complete current message; the notebook remains available for selected longer-term facts.

A same-question local measurement improved from 33.9 seconds to 7.4 seconds with the final prompt and output format, with no prompt tokens cached in the final measurement. A warm check returned in 4.75 seconds. These are individual checks on this computer rather than latency guarantees; answer length, conversation context, and computer load affect response time. Translations in this local route are constrained to English text. Measurements are recorded in `outputs/reply-speed-cold.json` and `outputs/reply-speed-english.json`.

A genuine lesson-help check explaining the topic particle は returned in 12.43 seconds. Its evidence is in `outputs/reply-speed-teacher.json`.

The optional OpenAI Responses integration is also implemented server-side, with structured replies, bounded context, optional corrections, rate limits, timeouts, same-origin checks, and safe errors. **No real OpenAI API key has been created or installed.** The secure local confirmation form failed to appear, so the game uses local AI instead. OpenAI end-to-end behavior remains unverified; its tests use a stub.

The local server loads `OPENAI_API_KEY` and optional `OPENAI_MODEL` from its process environment or the ignored `.env.local` file. The hosted backend uses Sites secret environment variables. The default model is `gpt-5.4-mini`; a configured key indicates presence, not verified billing or model access. Secret provisioning should continue through the approved OpenAI Developers workflow. Never place a key in `public/`, a browser form, this README, or the hosting manifest.

Hiroshi sensei’s conversational instructions are warm, curious, practical, and candid. It is a separate assistant, not the Codex chat, and it cannot automatically access past chats. Personal notebook entries are user-selected context for live conversations.

## Data and privacy

Chats, preferences, notebook notes, and phrases are saved in browser local storage, independently for each browser/device/origin. There is no cloud synchronization. Exported backups contain personal conversations and should be kept private; restoring one replaces the current browser's data after review. Clearing site data can remove progress.

Coursework, draft answers, and assignment attempts are included in that same device-local save and in exported backups. Older version-1 backups safely start with an empty course record when they contain no coursework. Existing saves and backups that used the original Koa default name migrate to Hiroshi sensei while retaining chats, homework, and progress. The character revision marker preserves later custom names, including if you deliberately choose Koa again. Reset this device also clears coursework. Homework due dates display in Japan Standard Time; the app does not send notifications or schedule messages.

The authored exercises check the specific taught form and listed variants, including Japanese writing and the shown romanization. A different natural paraphrase may need explanation in lesson chat. The checker supplies practice feedback rather than an official proficiency assessment. AI explanations can make mistakes. Grammar was checked against the [Japan Foundation Irodori Starter reference](https://www.irodori.jpf.go.jp/en/starter/pdf.html); lesson text and exercises are original.

In on-device mode, inference stays on this computer. In OpenAI mode, the latest bounded conversation history, preferences, and notebook context are sent through the server to OpenAI, with `store: false`. The game server does not log message content or credentials. Dictation may use the browser vendor's speech service. The initial app shell is cached for offline use; API responses are never cached.

## Validation

Run `node --test tests/*.test.mjs` for backend, guided-scene, and teacher-course checks. Run `node --check public/app.js`, `node --check public/teacher-ui.js`, and `node --check server.mjs` for syntax checks. Automated backend tests mock inference calls and never incur API use. Actual local-model end-to-end checks are recorded separately in `outputs/verification.json` and `outputs/teacher-verification.json`. The teacher report includes saved-draft, grading, revision, responsive-layout, private-hosting, and successful on-device lesson-help checks. OpenAI live inference requires a real-key end-to-end check if that optional route is configured later.

Character artwork is an original anime illustration in `public/assets/hiroshi-sensei.png`; scene artwork remains SVG source in `public/assets/`. The game does not copy Amiko branding or characters.

## Local model provenance

- Runtime: [llama.cpp release b11703](https://github.com/ggml-org/llama.cpp/releases/tag/b11703), Windows CPU x64 archive, SHA-256 `cf3050ac140fb9d8c726cdea5e3c16b1879c86e41443aabb84c948e9e100b9de`.
- Model: [Qwen3 4B GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF), `Qwen3-4B-Q4_K_M.gguf`, SHA-256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.
- Model/runtime licenses remain with their publishers. Runtime archive license files are retained alongside the extracted binaries. The original game's source and artwork are separate from the third-party AI assets.
