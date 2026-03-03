# AI Coding Agent Guide — Speech Assistant (Node.js)

Use this repo to run a phone-call voice assistant that bridges Twilio Media Streams with OpenAI’s Realtime API. Start with the architectural flow and follow the established patterns in the files below.

## Big Picture

- Twilio inbound call → TwiML webhook → Media Stream WebSocket → OpenAI Realtime WebSocket → audio round‑trip.
- Core entry point: [index.js](../index.js). Reference [README.md](../README.md) for setup and behavior.
- Fastify HTTP server exposes: `/` (root), `/healthz` (uptime), `/incoming-call` (TwiML), `/media-stream` (WebSocket for Twilio audio), `/sms` (Twilio Messaging webhook for auto‑replies), and markdown document routes (`/tos`, `/privacy-policy`, `/how-to-opt-in`).
- Audio from Twilio is forwarded to OpenAI via `input_audio_buffer.append`; assistant audio returns via `response.output_audio.delta` and is streamed back to Twilio.
- Realtime session + prompts live under [src/assistant](../src/assistant) (see [src/assistant/session.js](../src/assistant/session.js) and [src/assistant/prompts.js](../src/assistant/prompts.js)).

## Developer Workflow

- Install and run:
    - `npm install`
    - `npm start`
- Verify changes:
    - Always run `npm test` after every change and keep running it until failures are fixed.
    - `npm test` runs lint, typecheck, unit tests, and integration tests.
    - `npm run test:unit` for unit tests only.
    - `npm run test:integration` for integration tests only.
    - `npm run lint` for ESLint + Prettier checks.
    - `npm run lint:fix` to automatically fix ESLint + Prettier issues.
    - `npm run lint:eslint` and `npm run lint:eslint:fix` for ESLint-only runs.
    - `npm run format` for Prettier check-only.
    - `npm run format:write` (or `npm run format:fix`) to write formatting.
    - Transfer call validation tests live in [src/tools/transfer-call.test.js](../src/tools/transfer-call.test.js) and [src/routes/media-stream.test.js](../src/routes/media-stream.test.js).
- Prompt evaluations:
    - `npm run pf:eval:realtime-web-search`, `npm run pf:eval:sms`, `npm run pf:eval`, and `npm run pf:view` (configs in [tests/promptfoo](../tests/promptfoo)).
- Port: `PORT` env var controls Fastify; default in code is `10000`.
- Public ingress: bind ngrok domain via `NGROK_DOMAIN` and optional `NGROK_AUTHTOKEN`. The server also runs locally without ngrok.
- Minimal health checks: GET `/` and `/healthz`.
- Debug logging: set `NODE_ENV=development` for verbose logs across routes/tools.

## Environment & Secrets

- Required: `OPENAI_API_KEY`. Optional: `NGROK_DOMAIN`, `PRIMARY_USER_FIRST_NAME`, `SECONDARY_USER_FIRST_NAME`.
- Google Routes (directions): `GOOGLE_MAPS_API_KEY`.
- SPOT feed (latest track + timezone greeting): `SPOT_FEED_ID`, `SPOT_FEED_PASSWORD`.
- Email tool requires: `SENDER_FROM_EMAIL`, `SMTP_USER`, `SMTP_PASS`, `PRIMARY_TO_EMAIL`, `SECONDARY_TO_EMAIL`, `SMTP_NODEMAILER_SERVICE_ID`.
- Call allowlists: `PRIMARY_USER_PHONE_NUMBERS`, `SECONDARY_USER_PHONE_NUMBERS` (comma‑separated E.164).
- Tool toggles: `ALLOW_SEND_SMS=true` and `ALLOW_SEND_EMAIL=true` to enable `send_sms`/`send_email`.
- SMS send fallback: `TWILIO_SMS_FROM_NUMBER` when the TwiML parameter is missing.
- SMS consent records: `SMS_CONSENT_RECORDS_FILE_PATH` (default: `data/sms-consent-records.jsonl`)—stores consent audit trail.
- Markdown document routes: `TERMS_AND_CONDITIONS_FILE_PATH` (default: `tos.md`), `PRIVACY_POLICY_FILE_PATH` (default: `privacy-policy.md`), `HOW_TO_OPT_IN_FILE_PATH` (default: `how-to-opt-in.md`).
- Logs are sanitized at startup using `redact-logs` and `@zapier/secret-scrubber`. Disable via `DISABLE_LOG_REDACTION=true`. Add any new secret env keys to `REDACT_ENV_KEYS` (comma‑separated).

## Routing & Twilio Integration

- `/incoming-call`: returns TwiML that greets the caller, plays a brief hold message, then `<Connect><Stream>` to `/media-stream`. Caller number is passed via `<Parameter name="caller_number" ...>` and used for allowlist and email recipient selection.
- `/incoming-call` also passes `<Parameter name="twilio_number" ...>` so `send_sms` can reply from the same Twilio number.
- `/media-stream` (WebSocket):
    - Forwards Twilio `media` frames to OpenAI (`input_audio_buffer.append`).
    - Streams assistant audio deltas back to Twilio `media`.
    - Handles interruption with `input_audio_buffer.speech_started` by truncating the current assistant item and clearing Twilio’s buffer.
    - Uses “mark” messages to detect end of assistant playback for pacing.
    - After the initial greeting, turn detection is updated to manual response creation (see `input_audio_buffer.speech_stopped`).
- `/sms` (Messaging webhook):
    - Restricts usage to allowlisted numbers (`PRIMARY_USER_PHONE_NUMBERS`, `SECONDARY_USER_PHONE_NUMBERS`).
    - **Consent enrollment:** user texts `START` → "pending", user replies `YES` → "confirmed", user replies `STOP` → "opted_out". AI replies only sent when status is "confirmed". Records persisted to `SMS_CONSENT_RECORDS_FILE_PATH`.
    - Builds a 12‑hour recent thread (up to 10 messages, inbound+outbound) and composes a concise reply (≤320 chars).
    - Calls OpenAI `responses.create` with `model: gpt-5.2`, `tools: [{ type: 'web_search' }]`, `tool_choice: 'required'`, and tailored SMS instructions.
    - Sends the reply via Twilio REST API; falls back to TwiML with concise error text when send fails.
- `/tos`, `/privacy-policy`, `/how-to-opt-in` (Markdown document routes):
    - Serve as configurable markdown-to-HTML document endpoints.
    - File paths: `TERMS_AND_CONDITIONS_FILE_PATH`, `PRIVACY_POLICY_FILE_PATH`, `HOW_TO_OPT_IN_FILE_PATH` (with sensible defaults).
    - Render markdown files with a standard HTML wrapper and return as `text/html`.

## OpenAI Session & Tools

- Session initialization sets `type: realtime`, `model: gpt-realtime`, audio I/O formats (`audio/pcmu`), `voice: cedar`, and concatenated `REALTIME_INSTRUCTIONS` policy.
- Tools declared in session (implementations in [src/tools](../src/tools)):
    - `directions`: Uses Google Routes API to fetch turn-by-turn steps. Accepts address/place or lat/lng for origin/destination; origin can fall back to latest SPOT track when omitted. Requires `GOOGLE_MAPS_API_KEY`.
    - `gpt_web_search`: Implemented by calling the SDK `responses.create` with `tools: [{ type: 'web_search', user_location: ... }]` and `tool_choice: 'required'`. Result is sent back as a `function_call_output` and triggers `response.create`.
    - `send_email`: Uses Nodemailer single sender; selects `to` via caller group. Sends HTML‑only body; returns `messageId/accepted/rejected` as `function_call_output` and then `response.create`. Adds header `X-From-Ai-Assistant: true`.
    - `send_sms`: Sends a concise SMS from the call’s Twilio number (or fallback) and returns `sid/status/length` as `function_call_output`.
    - `transfer_call`: Transfers the live call to a destination number. Accepts US 10‑digit or full E.164; invalid numbers should prompt the caller to correct the input.
    - `update_mic_distance`: Toggles input noise reduction between `near_field` and `far_field`.
    - `end_call`: Ends the Twilio stream after a brief farewell.
- Dedupe: tool executions tracked by `call_id` to prevent duplicates. Always send `function_call_output` followed by `response.create`.

## SMS Auto‑Reply

- Webhook: `/sms` — configure in Twilio Console under Messaging → “A message comes in”.- **Consent enrollment:** users must explicitly enroll before receiving AI replies:
  - `START` → records "pending" status and prompts for `YES` confirmation.
  - `YES` → records "confirmed" status and enables AI SMS replies (when status was previously "pending").
  - `STOP` → records "opted_out" status and stops all AI replies; user can text `START` to re-enroll.
  - All consent events persisted to `SMS_CONSENT_RECORDS_FILE_PATH` for audit/compliance.- Allowlist: only numbers listed in `PRIMARY_USER_PHONE_NUMBERS` or `SECONDARY_USER_PHONE_NUMBERS` are allowed.
- Context: fetches last 12 hours of messages (inbound/outbound), merges and includes up to 10 in the prompt.
- Model & tools: OpenAI `responses.create` with `model: gpt-5.2` and `tools: [{ type: 'web_search' }]` (`tool_choice: 'required'`).
- Style: reply ≤320 chars, friendly and actionable; at most one short source label; URLs only when directly helpful.
- Errors: returns concise user texts — AI error → “Sorry—SMS reply error.”; send error → “Sorry—SMS send error.” with brief details.

## Voice & Interruption Patterns

- Keep answers voice‑friendly and concise; system prompts enforce style.
- On `response.output_audio.delta`, immediately stop any waiting music and send deltas as Twilio `media` payloads.
- On `input_audio_buffer.speech_started`, truncate current assistant response (`conversation.item.truncate`) and clear Twilio buffer to let the user speak.

## Waiting Music (Optional)

- Controlled via `WAIT_MUSIC_THRESHOLD_MS` and `WAIT_MUSIC_FOLDER` (raw PCMU only).
- Only raw PCMU (G.711 µ‑law) files are supported; frames are sent at ~20 ms (160 bytes).
- Use the conversion script when needed (requires `ffmpeg`): `npm run convert:wav -- --dir=music --format=mulaw`.
- Waiting music starts after the threshold when a tool call begins and stops on first assistant audio delta or caller speech.
- If the caller or assistant interrupts while a tool is still running, waiting music resumes after the interruption until the tool finishes.

## Conventions & Gotchas

- ESM modules (`"type": "module"`). Use `import` syntax throughout.
- Phone normalization is US‑focused: inputs normalized to E.164 with a leading `+1` when missing; `transfer_call` accepts US 10‑digit or full E.164 numbers.
- Allowlist empty → all calls rejected.
- Startup test email: sends a one‑time message to the PRIMARY user if email is configured.
- Health endpoint: `/healthz` (not `/health`).
- Greeting uses `PRIMARY_USER_FIRST_NAME`/`SECONDARY_USER_FIRST_NAME` only; there is no `USER_FIRST_NAME` env.
- Primary caller greetings optionally use the latest SPOT track timezone when available; otherwise default to `America/Los_Angeles`.

## Extending

- Add a new tool: declare it in the session `tools`, then in `response.done` handle the `function_call` by parsing `arguments`, performing work, sending `function_call_output`, and following with `response.create`. Reuse the `call_id` dedupe pattern.
- For new envs or integrations, update redaction keys and README examples, and keep WebSocket event handling consistent (append audio, handle deltas, interruption, and marks).
