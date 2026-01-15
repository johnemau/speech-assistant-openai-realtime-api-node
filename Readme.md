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
ngrok http 5050
```
Once the tunnel has been opened, copy the `Forwarding` URL. It will look something like: `https://[your-ngrok-subdomain].ngrok.app`. You will
need this when configuring your Twilio number setup.

Note that the `ngrok` command above forwards to a development server running on port `5050`, which is the default port configured in this application. If
you override the `PORT` defined in `index.js`, you will need to update the `ngrok` command accordingly.

Keep in mind that each time you run the `ngrok http` command, a new URL will be created, and you'll need to update it everywhere it is referenced below.

### Install required packages

Open a Terminal and run:
```
npm install
```

### Twilio setup

In your Phone Number configuration settings, update the first **A call comes in** dropdown to **Webhook**, and paste your ngrok forwarding URL (referenced above), followed by `/incoming-call`. For example, `https://[your-ngrok-subdomain].ngrok.app/incoming-call`. Then, click **Save configuration**.

### Update the .env file

Create a `/env` file, or copy the `.env.example` file to `.env`:

```
cp .env.example .env
```

In the .env file, update the `OPENAI_API_KEY` to your OpenAI API key from the **Prerequisites**.

node index.js
## Personalized Greeting

- **Env var:** `USER_FIRST_NAME`
- **Usage:** Set this to the caller's first name to get a cooler, personalized greeting when the call connects.
- **Example `.env`:**

```
USER_FIRST_NAME=Jordan
```

If `USER_FIRST_NAME` is not set, the assistant will greet you as "legend".
```
## Test the app
With the development server running, call the phone number you purchased in the **Prerequisites**. After the introduction, you should be able to talk to the AI Assistant. Have fun!

## Special features

### Have the AI speak first
To have the AI voice assistant talk before the user, uncomment the line `// sendInitialConversationItem();`. The initial greeting is controlled in `sendInitialConversationItem`.

### Interrupt handling/AI preemption
When the user speaks and OpenAI sends `input_audio_buffer.speech_started`, the code will clear the Twilio Media Streams buffer and send OpenAI `conversation.item.truncate`.

Depending on your application's needs, you may want to use the [`input_audio_buffer.speech_stopped`](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/speech_stopped) event, instead.

### Waiting Music During Tool Calls (optional)

Play a soft background tone while the assistant executes long-running tool calls (for example, web search). Music starts after a configurable threshold and stops immediately when assistant audio resumes or when the caller speaks.

Enable via environment flags in `.env`:

```
ENABLE_WAIT_MUSIC=true
WAIT_MUSIC_THRESHOLD_MS=700
WAIT_MUSIC_VOLUME=0.12
WAIT_MUSIC_FILE=melodyloops-relaxing-jazz.wav
```

Notes:
- Audio is PCMU (G.711 µ-law), 8 kHz, mono; frames are sent at ~20 ms cadence to Twilio.
- Music starts after `WAIT_MUSIC_THRESHOLD_MS` when a tool call begins and stops on the first assistant `response.output_audio.delta`, on `input_audio_buffer.speech_started`, and at cleanup.
- Adjust `WAIT_MUSIC_FREQ_HZ` and `WAIT_MUSIC_VOLUME` to taste. Keep volume low to avoid distraction and clipping.

Provide a `.wav` file; the app parses WAV directly (PCM 16-bit) and downmixes/resamples to 8 kHz mono in-process, then streams PCMU frames. Non-WAV files are not supported.

### Allowlist Inbound Callers

Restrict who can call into the assistant via an allowlist. Configure a comma-separated list of E.164 phone numbers in `.env`:

```
ALLOWED_CALLERS=+12065551234
```

Notes:
- Twilio sends the caller number as `From` in E.164 format (e.g., `+12065551234`).
- If `ALLOWED_CALLERS` is not set or empty, all incoming calls will be rejected.
- Non-listed callers receive a brief message and the call is hung up.
