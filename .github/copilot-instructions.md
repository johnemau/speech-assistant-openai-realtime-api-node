# AI Coding Agent Guide — Speech Assistant (Node.js)

Use this repo to run a phone-call voice assistant that bridges Twilio Media Streams with OpenAI’s Realtime API. Start with the architectural flow and follow the established patterns in the files below.

## Big Picture
- Twilio inbound call → TwiML webhook → Media Stream WebSocket → OpenAI Realtime WebSocket → audio round‑trip.
- Core entry point: [index.js](../index.js). Reference [Readme.md](../Readme.md) for setup and behavior.
- Fastify HTTP server exposes: `/` (root), `/healthz` (uptime), `/incoming-call` (TwiML), and `/media-stream` (WebSocket for Twilio audio).
- Audio from Twilio is forwarded to OpenAI via `input_audio_buffer.append`; assistant audio returns via `response.output_audio.delta` and is streamed back to Twilio.

## Developer Workflow
- Install and run:
  - `npm install`
  - `npm start`
- Port: `PORT` env var controls Fastify; default in code is `10000`.
- Public ingress: bind ngrok domain via `NGROK_DOMAIN` and optional `NGROK_AUTHTOKEN`. The server also runs locally without ngrok.
- Minimal health checks: GET `/` and `/healthz`.

## Environment & Secrets
- Required: `OPENAI_API_KEY`. Optional: `NGROK_DOMAIN`, `PRIMARY_USER_FIRST_NAME`, `SECONDARY_USER_FIRST_NAME`.
- Email tool requires: `SENDER_FROM_EMAIL`, `SMTP_USER`, `SMTP_PASS`, `PRIMARY_TO_EMAIL`, `SECONDARY_TO_EMAIL`, `SMTP_NODEMAILER_SERVICE_ID`.
- Call allowlists: `PRIMARY_USER_PHONE_NUMBERS`, `SECONDARY_USER_PHONE_NUMBERS` (comma‑separated E.164).
- Logs are sanitized at startup using `redact-logs` and `@zapier/secret-scrubber`. Disable via `DISABLE_LOG_REDACTION=true`. Add any new secret env keys to `REDACT_ENV_KEYS` (comma‑separated).

## Routing & Twilio Integration
- `/incoming-call`: returns TwiML that greets the caller, then `<Connect><Stream>` to `/media-stream`. Caller number is passed via `<Parameter name="caller_number" ...>` and used for allowlist and email recipient selection.
- `/media-stream` (WebSocket):
  - Forwards Twilio `media` frames to OpenAI (`input_audio_buffer.append`).
  - Streams assistant audio deltas back to Twilio `media`.
  - Handles interruption with `input_audio_buffer.speech_started` by truncating the current assistant item and clearing Twilio’s buffer.
  - Uses “mark” messages to detect end of assistant playback for pacing.

## OpenAI Session & Tools
- Session initialization sets `type: realtime`, `model: gpt-realtime`, audio I/O formats (`audio/pcmu`), `voice: cedar`, and concatenated `SYSTEM_MESSAGE` policy.
- Tools declared in session:
  - `gpt_web_search`: Implemented by calling the SDK `responses.create` with `tools: [{ type: 'web_search', user_location: ... }]` and `tool_choice: 'required'`. Result is sent back as a `function_call_output` and triggers `response.create`.
  - `send_email`: Uses Nodemailer single sender; selects `to` via caller group. Sends HTML‑only body; returns `messageId/accepted/rejected` as `function_call_output` and then `response.create`. Adds header `X-From-Ai-Assistant: true`.
- Dedupe: tool executions tracked by `call_id` to prevent duplicates. Always send `function_call_output` followed by `response.create`.

## Voice & Interruption Patterns
- Keep answers voice‑friendly and concise; system prompts enforce style.
- On `response.output_audio.delta`, immediately stop any waiting music and send deltas as Twilio `media` payloads.
- On `input_audio_buffer.speech_started`, truncate current assistant response (`conversation.item.truncate`) and clear Twilio buffer to let the user speak.

## Waiting Music (Optional)
- Controlled via `WAIT_MUSIC_THRESHOLD_MS`, `WAIT_MUSIC_VOLUME`, `WAIT_MUSIC_FILE`.
- Only WAV files are supported; the app parses WAV PCM 16‑bit, downmixes/resamples to 8 kHz mono, and encodes PCMU frames (~20 ms, 160 bytes).
- Waiting music starts after the threshold when a tool call begins and stops on first assistant audio delta or caller speech.

## Conventions & Gotchas
- ESM modules (`"type": "module"`). Use `import` syntax throughout.
- Phone normalization is US‑focused: inputs normalized to E.164 with a leading `+1` when missing.
- Allowlist empty → all calls rejected.
- Startup test email: sends a one‑time message to the PRIMARY user if email is configured.
- Health endpoint: `/healthz` (not `/health`).
- Greeting uses `PRIMARY_USER_FIRST_NAME`/`SECONDARY_USER_FIRST_NAME` only; there is no `USER_FIRST_NAME` env.

## Extending
- Add a new tool: declare it in the session `tools`, then in `response.done` handle the `function_call` by parsing `arguments`, performing work, sending `function_call_output`, and following with `response.create`. Reuse the `call_id` dedupe pattern.
- For new envs or integrations, update redaction keys and README examples, and keep WebSocket event handling consistent (append audio, handle deltas, interruption, and marks).
