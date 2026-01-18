#  Speech Assistant with Twilio Voice and the OpenAI Realtime API (Node.js)

This application demonstrates how to use Node.js, [Twilio Voice](https://www.twilio.com/docs/voice) and [Media Streams](https://www.twilio.com/docs/voice/media-streams), and [OpenAI's Realtime API](https://platform.openai.com/docs/) to make a phone call to speak with an AI Assistant. 

The application opens websockets with the OpenAI Realtime API and Twilio, and sends voice audio from one to the other to enable a two-way conversation.

See [here](https://www.twilio.com/en-us/blog/voice-ai-assistant-openai-realtime-api-node) for a tutorial overview of the code.

This application uses the following Twilio products in conjuction with OpenAI's Realtime API:
- Voice (and TwiML, Media Streams)
- Phone Numbers

> [!NOTE]
> Outbound calling is beyond the scope of this app. However, we demoed [one way to do it here](https://www.twilio.com/en-us/blog/outbound-calls-node-openai-realtime-api-voice).

## Prerequisites

To use the app, you will  need:

- **Node.js 18+** We used \`18.20.4\` for development; download from [here](https://nodejs.org/).
- **A Twilio account.** You can sign up for a free trial [here](https://www.twilio.com/try-twilio).
- **A Twilio number with _Voice_ capabilities.** [Here are instructions](https://help.twilio.com/articles/223135247-How-to-Search-for-and-Buy-a-Twilio-Phone-Number-from-Console) to purchase a phone number.
- **An OpenAI account and an OpenAI API Key.** You can sign up [here](https://platform.openai.com/).
  - **OpenAI Realtime API access.**

## Local Setup

There are 4 required steps to get the app up-and-running locally for development and testing:
1. Run ngrok or another tunneling solution to expose your local server to the internet for testing. Download ngrok [here](https://ngrok.com/).
2. Install the packages
3. Twilio setup
4. Update the .env file

### Open an ngrok tunnel
When developing & testing locally, you'll need to open a tunnel to forward requests to your local development server. These instructions use ngrok.

Open a Terminal and run:
```
ngrok http 10000
```
Once the tunnel has been opened, copy the Forwarding URL. It will look something like: `https://[your-ngrok-subdomain].ngrok.app`. You will
need this when configuring your Twilio number setup.

Notes:
- The app defaults to `PORT=10000`. If you change the port via the `PORT` environment variable, update the `ngrok http` command accordingly.
- If you use a custom domain, ensure it's reserved in your ngrok account and set `NGROK_DOMAIN` to that domain. When `NGROK_DOMAIN` is set, the server binds that domain automatically at startup.

### Install required packages

Open a Terminal and run:
```
npm install
```

### Run tests

Quickly verify code changes and linting:
```
npm test
```
Notes:
- The default test script runs ESLint to catch issues early.

### Redact sensitive env values in logs

Prevent accidental printing of secret environment variables to `console.log` and `process.stdout`.

This app enables redaction at startup, replacing any configured env values with `[secure]` when they appear in logs or CLI output.

- Default redacted keys: `OPENAI_API_KEY`, `NGROK_AUTHTOKEN`, `SMTP_PASS`, `SMTP_USER`, `SENDER_FROM_EMAIL`, `PRIMARY_TO_EMAIL`, `SECONDARY_TO_EMAIL`, `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `SECRET_ENV_VAR`.
- Add more via a comma-separated env: `REDACT_ENV_KEYS=MY_SECRET,ANOTHER_TOKEN`.
- Disable globally via: `DISABLE_LOG_REDACTION=true`.

Example behavior:

```js
process.env.SECRET_ENV_VAR = 'secret value';

// Before enabling (if disabled):
console.log('process.env.SECRET_ENV_VAR=', process.env.SECRET_ENV_VAR);
// prints: process.env.SECRET_ENV_VAR=secret value
process.stdout.write(`process.stdout.write=${process.env.SECRET_ENV_VAR}\n`);
// prints: process.stdout.write=secret value

// After redaction is enabled at startup:
console.log('process.env.SECRET_ENV_VAR=', process.env.SECRET_ENV_VAR);
// prints: process.env.SECRET_ENV_VAR=[secure]
process.stdout.write(`process.stdout.write=${process.env.SECRET_ENV_VAR}\n`);
// prints: process.stdout.write=[secure]

// Or enable/disable manually in code:
// const disableLogRedactionFunc = patchLogs(['SECRET_ENV_VAR'])
// ... logs are redacted ...
// disableLogRedactionFunc()
// You can also restore original logging during debugging by setting DISABLE_LOG_REDACTION=true
```

Note: Redaction only affects console output; it does not sanitize data sent to third-party services or files.

### Twilio setup

In your Phone Number configuration settings, update the first **A call comes in** dropdown to **Webhook**, and paste your ngrok forwarding URL (referenced above), followed by `/incoming-call`. For example, `https://[your-ngrok-subdomain].ngrok.app/incoming-call`. Then, click **Save configuration**.

For SMS auto-replies, set the **A message comes in** webhook to your forwarding URL followed by `/sms`, for example: `https://[your-ngrok-subdomain].ngrok.app/sms`.

### Update the .env file

Create a `.env` file with the required variables:

```
OPENAI_API_KEY=sk-...
NGROK_AUTHTOKEN=...
NGROK_DOMAIN=your-subdomain.ngrok.app
PORT=10000
```

Then start the server:

```
npm start
```

You should see logs similar to:

```
Starting server...
HTTP server listening on 0.0.0.0:10000
ngrok forwarding active on domain your-subdomain.ngrok.app
```

Quick local checks:
- Visit http://localhost:10000/ to confirm the root endpoint.
- Visit http://localhost:10000/healthz for a simple health check.
- Run `npm test` to lint and verify code changes.

### SMS Auto‑Reply

Let the assistant auto‑reply to SMS using GPT‑5.2 with the `web_search` tool.

- Webhook: `/sms` (configure in Twilio Console under Messaging → “A message comes in”)
- Allowlist: only numbers listed in `PRIMARY_USER_PHONE_NUMBERS` or `SECONDARY_USER_PHONE_NUMBERS` are allowed.
- Thread context: the app fetches up to the last 10 messages exchanged with the caller in the past 12 hours (both inbound and outbound), merges them, and includes this thread in the prompt.
- Model and tools: calls OpenAI `responses.create` with `model: gpt-5.2` and `tools: [{ type: 'web_search' }]` (tool_choice=`required`).
- Reply style: concise, friendly SMS (≤320 chars), at most one short source label when facts are used.

Required environment variables for SMS:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PRIMARY_USER_PHONE_NUMBERS=+12065551234
SECONDARY_USER_PHONE_NUMBERS=+14255550123,+14255550124
```

Notes:
- Replies are sent via Twilio REST API from the same Twilio number that received the message.
- The SMS webhook responds with empty TwiML to avoid duplicate replies.
- If credentials are missing or the number is not allowed, the webhook returns a short TwiML message.
## Personalized Greeting

- **Env vars:** `PRIMARY_USER_FIRST_NAME`, `SECONDARY_USER_FIRST_NAME`
- **Usage:** Set distinct names for primary and secondary callers. The assistant greets primary callers with `PRIMARY_USER_FIRST_NAME` and secondary callers with `SECONDARY_USER_FIRST_NAME`.
- **Example `.env`:**

```
PRIMARY_USER_FIRST_NAME=Jordan
SECONDARY_USER_FIRST_NAME=Taylor
```

If a name is not set for the matching caller group, the assistant will greet you as "legend".
```
## Test the app
With the development server running, call the phone number you purchased in the **Prerequisites**. After the introduction, you should be able to talk to the AI Assistant. Have fun!

## Special features

### Assistant speaks first (default)
The assistant sends a short greeting on stream start and then speaks first. To customize the greeting, edit the `sendInitialConversationItem` helper in [index.js](index.js). The TwiML webhook also greets the caller by name before connecting the media stream.

### Interrupt handling/AI preemption
When the user speaks and OpenAI sends `input_audio_buffer.speech_started`, the code will clear the Twilio Media Streams buffer and send OpenAI `conversation.item.truncate`.

Depending on your application's needs, you may want to use the [`input_audio_buffer.speech_stopped`](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/speech_stopped) event, instead.

### Waiting Music During Tool Calls (optional)

Play a soft background tone while the assistant executes long-running tool calls (for example, web search). Music starts after a configurable threshold and stops immediately when assistant audio resumes or when the caller speaks.

Enable via environment flags in `.env`:

```
WAIT_MUSIC_THRESHOLD_MS=700
WAIT_MUSIC_VOLUME=0.12
WAIT_MUSIC_FILE=melodyloops-relaxing-jazz.wav
```

Notes:
- Audio is PCMU (G.711 µ-law), 8 kHz, mono; frames are sent at ~20 ms cadence to Twilio.
- Music starts after `WAIT_MUSIC_THRESHOLD_MS` when a tool call begins and stops on the first assistant `response.output_audio.delta`, on `input_audio_buffer.speech_started`, and at cleanup.
- Adjust `WAIT_MUSIC_VOLUME` to taste. Keep volume low to avoid distraction and clipping.

Provide a `.wav` file; the app parses WAV directly (PCM 16-bit) and downmixes/resamples to 8 kHz mono in-process, then streams PCMU frames. Non-WAV files are supported only via WAV; ffmpeg is not used.

### Speakerphone Mic Distance Toggle

Optimize input noise reduction when the caller switches to/from speakerphone.

- Tool: `update_mic_distance(mode: near_field | far_field, reason?: string)`
- Behavior: The assistant listens for phrases like “you’re on speaker” → switches to `far_field`, and “taking you off speaker” → switches to `near_field`.
- Also handles car/Bluetooth phrasing: “connected to car bluetooth”, “you are on the car”, “car speakers” → `far_field`; and “taking off car”, “off bluetooth” → `near_field`.
- Debounce: Repeated requests within ~2s are ignored; no-ops are skipped when the requested mode equals the current mode.

Implementation details:
- The Realtime session initializes with `audio.input.noise_reduction.type = near_field`.
- On tool call, the server sends a partial `session.update` that sets `audio.input.noise_reduction.type` to the requested mode.
- After the tool result is sent, the model speaks a brief confirmation.

Notes:
- `noise_reduction` improves VAD/turn detection and input clarity. Use `near_field` for close-talking mics (headsets) and `far_field` for speakerphone/laptop mics.
- Events: `session.updated` is logged for visibility.

### Allowlist Inbound Callers

Restrict who can call into the assistant via allowlists and greet them differently based on group.

- **Env vars:** `PRIMARY_USER_PHONE_NUMBERS`, `SECONDARY_USER_PHONE_NUMBERS`
- **Format:** Comma-separated E.164 numbers (e.g., `+12065551234`).
- **Example `.env`:**

```
PRIMARY_USER_PHONE_NUMBERS=+12065551234
SECONDARY_USER_PHONE_NUMBERS=+14255550123,+14255550124
```

Notes:
- Twilio sends the caller number as `From` in E.164 format.
- If both lists are empty, all incoming calls will be rejected.
- Non-listed callers receive a brief message and the call is hung up.

### Email Tool (Nodemailer service)

Let the assistant send an HTML email with the latest conversation context when the caller says "email me that" or similar. The assistant composes the subject and HTML body and calls the `send_email` tool; the server selects the recipient based on the caller’s phone number. There is a single sender SMTP account used for both recipients.

- The email body must be HTML-only. No plaintext.
- A custom header `FROM-AI-ASSITANT` is included with each message.

Environment variables:

```
# Nodemailer service ID (e.g., protonmail, gmail)
SMTP_NODEMAILER_SERVICE_ID=gmail // https://nodemailer.com/smtp/well-known-services

# Single sender SMTP account
SENDER_FROM_EMAIL=sender@example.com
SMTP_USER=smtp_user
SMTP_PASS=smtp_password_or_app_password

# Recipient addresses per caller group
PRIMARY_TO_EMAIL=primary.recipient@example.com
SECONDARY_TO_EMAIL=secondary.recipient@example.com
```

Behavior:
- The app adds a TwiML `<Parameter name="caller_number" ...>` so Twilio passes the caller number into the Media Stream `start` event.
- If the caller is in `PRIMARY_USER_PHONE_NUMBERS`, email is sent to `PRIMARY_TO_EMAIL`; if in `SECONDARY_USER_PHONE_NUMBERS`, email is sent to `SECONDARY_TO_EMAIL`.
- A custom header `X-From-Ai-Assistant: true` is included with each message.
- If required config is missing (`SENDER_FROM_EMAIL`, `SMTP_USER`, `SMTP_PASS`, or the matching `*_TO_EMAIL`), the assistant responds briefly that email isn’t configured for this caller.

Provider notes:
- Many providers require app passwords for SMTP.
- For ProtonMail, set `SMTP_NODEMAILER_SERVICE_ID=protonmail` and use an app password.

Usage:
- Say "email me that" after the assistant provides information.
- The assistant will compose a short subject and an HTML-only body, then confirm send status.

### End Call (Goodbye)

Politely end the call on common goodbye phrases.

- Phrases: "hang up", "goodbye", "bye now", "disconnect", "end the call".
- Tool: `end_call` — the assistant calls this, then speaks one brief goodbye.
- Behavior: The server closes the Twilio Media Stream and the OpenAI WebSocket immediately after the goodbye audio finishes.
