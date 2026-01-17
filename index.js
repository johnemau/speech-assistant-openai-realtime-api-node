import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import OpenAI from 'openai';
import fs from 'fs';
import nodemailer from 'nodemailer';
import patchLogs from 'redact-logs';
import { scrub, findSensitiveValues } from '@zapier/secret-scrubber';

// Load environment variables from .env file
dotenv.config();

// Enable redaction of sensitive env vars from console and stdout
function isTruthy(val) {
    const v = String(val || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Environment flags
const IS_DEV = String(process.env.NODE_ENV || '').toLowerCase() === 'development';

const DEFAULT_SECRET_ENV_KEYS = [
    'OPENAI_API_KEY',
    'NGROK_AUTHTOKEN',
    'SMTP_NODEMAILER_SERVICE_ID',
    'SMTP_PASS',
    'SMTP_USER',
    'SENDER_FROM_EMAIL',
    'PRIMARY_TO_EMAIL',
    'SECONDARY_TO_EMAIL',
    // Caller-related environment variables
    'PRIMARY_USER_PHONE_NUMBERS',
    'SECONDARY_USER_PHONE_NUMBERS',
    'PRIMARY_USER_FIRST_NAME',
    'SECONDARY_USER_FIRST_NAME',
    'USER_FIRST_NAME',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_API_KEY',
    'TWILIO_API_SECRET',
];

let disableLogRedaction = null;
try {
    const extraKeys = (process.env.REDACT_ENV_KEYS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const keys = Array.from(new Set([...DEFAULT_SECRET_ENV_KEYS, ...extraKeys]));
    // Enable redaction by default
    disableLogRedaction = patchLogs(keys);
    // Optional: brief confirmation without leaking values
    console.log('Log redaction enabled for env keys:', keys);
    // If env flag is truthy, disable the redaction immediately
    if (isTruthy(process.env.DISABLE_LOG_REDACTION)) {
        try {
            disableLogRedaction();
            console.log('Log redaction disabled via DISABLE_LOG_REDACTION env flag.');
        } catch (err) {
            console.warn('Failed to disable log redaction:', err?.message || err);
        }
    }
} catch (e) {
    console.warn('Failed to initialize log redaction:', e?.message || e);
}

// Wrap console methods to proactively scrub sensitive data in any logged objects
// Uses secret-scrubber's heuristics and known env secret values.
try {
    const envSecretValues = (() => {
        const extraKeys = (process.env.REDACT_ENV_KEYS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const keys = Array.from(new Set([...DEFAULT_SECRET_ENV_KEYS, ...extraKeys]));
        const vals = [];
        for (const k of keys) {
            const v = process.env[k];
            if (typeof v === 'string' && v.length > 0) vals.push(v);
        }
        return vals;
    })();

    const original = {
        log: console.log.bind(console),
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.info.bind(console),
    };

    const sanitizeArgs = (args) => {
        let guessed = [];
        try {
            for (const a of args) {
                if (a && typeof a === 'object') {
                    try {
                        guessed.push(...findSensitiveValues(a));
                    } catch {}
                }
            }
        } catch {}
        const secrets = Array.from(new Set([...
            envSecretValues,
            ...guessed,
        ]));

        return args.map((a) => {
            try {
                if (typeof a === 'string' || (a && typeof a === 'object') || Array.isArray(a)) {
                    return scrub(a, secrets);
                }
            } catch {}
            return a;
        });
    };

    console.log = (...args) => original.log(...sanitizeArgs(args));
    console.error = (...args) => original.error(...sanitizeArgs(args));
    console.warn = (...args) => original.warn(...sanitizeArgs(args));
    console.info = (...args) => original.info(...sanitizeArgs(args));
} catch (e) {
    // If scrubber initialization fails, leave console untouched
    console.warn('Secret scrubber initialization failed:', e?.message || e);
}

// Retrieve required environment variables.
const { OPENAI_API_KEY, NGROK_DOMAIN, PRIMARY_USER_FIRST_NAME, SECONDARY_USER_FIRST_NAME, USER_FIRST_NAME } = process.env;

// Email-related environment variables
const {
    SENDER_FROM_EMAIL,
    SMTP_USER,
    SMTP_PASS,
    PRIMARY_TO_EMAIL,
    SECONDARY_TO_EMAIL,
    SMTP_NODEMAILER_SERVICE_ID,
} = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

if (!NGROK_DOMAIN) {
    console.warn('NGROK_DOMAIN not set; skipping ngrok binding. Service will be reachable via platform routing.');
}

// Initialize OpenAI client
const openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });

let senderTransport = null;

// Initialize Nodemailer transporter (single sender) using service ID
if (SMTP_USER && SMTP_PASS) {
    senderTransport = nodemailer.createTransport({
        service: SMTP_NODEMAILER_SERVICE_ID,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    senderTransport.verify().then(() => {
        console.log('Email transporter verified.');
    }).catch((err) => {
        console.warn('Email transporter verification failed:', err?.message || err);
    });
} else {
    console.warn('SMTP credentials missing; send_email will be unavailable.');
}
if (!SENDER_FROM_EMAIL) {
    console.warn('SENDER_FROM_EMAIL missing; emails cannot be sent until configured.');
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = `# System Role
You are a voice-only AI assistant participating in a live phone call using the OpenAI Realtime API.

# Role and Goals
- Provide accurate, concise, and up-to-date information in a natural speaking voice.
- Optimize for low latency, clarity, and clean turn-taking.
- Prefer correctness and verified facts over speculation or improvisation.

# Tool Use
- For every user question, always call the tool named gpt_web_search before speaking.
- Keep queries short and specific; include **user_location** only when it materially affects the answer.
- If the user mentions location information, pass **user_location** to gpt_web_search with extracted 'city', 'region' (state/province/country), and 'country' when inferable.
- Make at most one tool call per user turn.
- Wait for the tool response before speaking.
- Base factual statements strictly on the tool output; do not rely on memory for facts.
- When the user mentions a location, populate the tool argument 'user_location' by extracting 'city' and 'region' (state/province/country) from their speech.
- When calling gpt_web_search, include 'user_location' with the extracted details whenever a location is mentioned.
- Set 'type' to "approximate" and set 'country' to a two-letter code when inferable (e.g., US, FR). If country is not stated but the location is in the United States, default 'country' to US.
- Examples:
    - "I am in Tucson Arizona" → 'user_location': { type: "approximate", country: "US", region: "Arizona", city: "Tucson" }
    - "I will be in Paris, France" → 'user_location': { type: "approximate", country: "FR", region: "Île-de-France", city: "Paris" }

# Email Tool
- When the caller says "email me that" or similar, call the tool named send_email.
- Compose the tool args from the latest conversation context — do not invent outside facts.
- Provide a short, clear 'subject' and 'body_html' containing an HTML-only body. Include relevant URLs as clickable links when they are available.
- After calling send_email and receiving the result, respond briefly confirming success or describing any error.

# Speaking Style
- Keep responses brief and voice-friendly, typically 1–3 short sentences.
- Use plain language and natural pacing.
- Avoid lists, long explanations, or monologues.
- Do not use filler phrases, sound effects, or onomatopoeia.
- Do not claim you are about to perform an action unless you immediately execute the corresponding tool call.
- Avoid meta statements like "I will look that up for you" unless a tool call is being performed right now.
- When reading numbers, IDs, or codes, speak each character individually with hyphens (for example: 4-1-5).
- Repeat numbers exactly as provided, without correction or inference.

# Sources and Attribution
- If the tool response includes sources or dates, mention at most one or two reputable sources with the date.
  Example: “Source: Reuters, January 2026.”
- Never invent or guess sources or dates.

# Language and Clarity
- Always respond in the user’s language.
- If results are empty, conflicting, or unreliable, clearly state that and ask one concise clarifying question.

# Audio Handling
- Respond only to clear and intelligible speech.
- If audio is unclear, noisy, incomplete, or ambiguous, ask the user to repeat or clarify.

# Turn-Taking and Interruption
- If the user begins speaking while you are responding, stop speaking immediately.
- Listen and resume only if appropriate, with a concise reply.

# Safety
- If the user requests harmful, hateful, racist, sexist, lewd, or violent content, reply exactly:
  “Sorry, I can’t assist with that.”
`;
// Instructions for web-search `responses.create` to produce detailed, voice-friendly output
const WEB_SEARCH_INSTRUCTIONS = 'Prepare a voice-ready answer for a live call using gpt-realtime. Provide a detailed, fact-rich response that is easy to follow over the phone. Prioritize useful, actionable facts and omit filler. When relevant (e.g., a business), include the name, address, phone number, hours (if available), and review score. Present information in clear, short sentences or brief phrases that are easy to hear. Do not include URLs. Include concise source labels only (for example: "Source: Yelp" or "Source: Reuters"). Use natural phrasing and readable pacing for speech.';
const VOICE = 'cedar';
const TEMPERATURE = 0.8; // Controls the randomness of the AI's responses
const PORT = process.env.PORT || 10000; // Render default PORT is 10000

// Allowed callers (E.164). Configure via env `PRIMARY_USER_PHONE_NUMBERS` and `SECONDARY_USER_PHONE_NUMBERS` as comma-separated numbers.
function normalizeUSNumberToE164(input) {
    if (!input) return null;
    // Remove non-digits except leading +
    const trimmed = String(input).trim();
    if (trimmed.startsWith('+')) {
        // Keep only + and digits
        const normalized = '+' + trimmed.replace(/[^0-9]/g, '');
        return normalized;
    }
    // Strip all non-digits
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (!digits) return null;
    // Ensure leading country code 1 for US
    const withCountry = digits.startsWith('1') ? digits : ('1' + digits);
    return '+' + withCountry;
}

const PRIMARY_CALLERS_SET = new Set(
    (process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map(s => normalizeUSNumberToE164(s))
        .filter(Boolean)
);
const SECONDARY_CALLERS_SET = new Set(
    (process.env.SECONDARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map(s => normalizeUSNumberToE164(s))
        .filter(Boolean)
);
// If both lists are empty, no callers are allowed.
const ALL_ALLOWED_CALLERS_SET = new Set([...PRIMARY_CALLERS_SET, ...SECONDARY_CALLERS_SET]);

// Waiting music configuration (optional)
const WAIT_MUSIC_THRESHOLD_MS = Number(process.env.WAIT_MUSIC_THRESHOLD_MS || 700);
const WAIT_MUSIC_VOLUME = Number(process.env.WAIT_MUSIC_VOLUME || 0.12); // 0.0 - 1.0
const WAIT_MUSIC_FILE = process.env.WAIT_MUSIC_FILE || null; // e.g., assets/wait-music.mp3

// List of Event Types to log to the console. See the OpenAI Realtime API Documentation: https://platform.openai.com/docs/api-reference/realtime
const LOG_EVENT_TYPES = [
    'error',
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
    'session.updated'
];

// Show AI response elapsed timing calculations
const SHOW_TIMING_MATH = false;

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Health Check Route (for Render/uptime monitors)
fastify.get('/healthz', async (request, reply) => {
    // Respond quickly with a 2xx to indicate instance is healthy
    reply.code(200).send({ status: 'ok' });
});

// Route for Twilio to handle incoming calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    const fromRaw = request.body?.From || request.body?.from || request.body?.Caller;
    const fromE164 = normalizeUSNumberToE164(fromRaw);
    console.log('Incoming call from:', fromRaw, '=>', fromE164);

    if (!fromE164 || !ALL_ALLOWED_CALLERS_SET.has(fromE164)) {
        const denyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Charon">Sorry, this line is restricted. Goodbye.</Say>
                              <Hangup/>
                          </Response>`;
        return reply.type('text/xml').send(denyTwiml);
    }

    // Choose greeting based on caller list membership
    const primaryName = (PRIMARY_USER_FIRST_NAME || USER_FIRST_NAME || '').trim();
    const secondaryName = (SECONDARY_USER_FIRST_NAME || '').trim();
    let callerName = 'legend';
    if (PRIMARY_CALLERS_SET.has(fromE164) && primaryName) {
        callerName = primaryName;
    } else if (SECONDARY_CALLERS_SET.has(fromE164) && secondaryName) {
        callerName = secondaryName;
    }
    // Determine current time in Washington State (America/Los_Angeles)
    const pacificHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }).format(new Date()));
    const timeGreeting = (pacificHour >= 5 && pacificHour < 12)
        ? 'Good morning'
        : (pacificHour >= 12 && pacificHour < 17)
            ? 'Good afternoon'
            : 'Good evening';
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Charon">${timeGreeting}, ${callerName}. Connecting to your AI assistant momentarily.</Say>
                              <Pause length="1"/>
                              <Say voice="Google.en-US-Chirp3-HD-Charon">At your service, ${callerName}. How may I help?</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream">
                                      <Parameter name="caller_number" value="${fromE164}" />
                                  </Stream>
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Client connected');

        // Connection-specific state
        let streamSid = null;
        let currentCallerE164 = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        // Waiting music state
        let isWaitingMusic = false;
        let waitingMusicInterval = null;
        let waitingMusicStartTimeout = null;
        let toolCallInProgress = false;
        // ffmpeg removed; we only support WAV files and tone fallback
        let waitingMusicUlawBuffer = null;
        let waitingMusicOffset = 0;
        // Parse a WAV file and convert to µ-law (PCMU) 8kHz mono bytes
        function parseWavToUlaw(filePath) {
            const buf = fs.readFileSync(filePath);
            if (buf.length < 44) throw new Error('WAV file too small');
            if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
                throw new Error('Not a RIFF/WAVE file');
            }
            let pos = 12;
            let audioFormat = null;
            let numChannels = null;
            let sampleRate = null;
            let bitsPerSample = null;
            let dataOffset = null;
            let dataSize = null;
            while (pos + 8 <= buf.length) {
                const chunkId = buf.toString('ascii', pos, pos + 4);
                const chunkSize = buf.readUInt32LE(pos + 4);
                if (chunkId === 'fmt ') {
                    audioFormat = buf.readUInt16LE(pos + 8);
                    numChannels = buf.readUInt16LE(pos + 10);
                    sampleRate = buf.readUInt32LE(pos + 12);
                    bitsPerSample = buf.readUInt16LE(pos + 22);
                } else if (chunkId === 'data') {
                    dataOffset = pos + 8;
                    dataSize = chunkSize;
                }
                pos += 8 + chunkSize;
            }
            if (audioFormat !== 1) throw new Error('WAV must be PCM');
            if (bitsPerSample !== 16) throw new Error('WAV must be 16-bit');
            if (!dataOffset || !dataSize) throw new Error('WAV data chunk not found');
            const bytesPerSample = 2; // 16-bit PCM
            const frames = Math.floor(dataSize / (bytesPerSample * numChannels));
            const monoSamples = new Int16Array(frames);
            // Downmix to mono
            for (let i = 0; i < frames; i++) {
                let sum = 0;
                for (let ch = 0; ch < numChannels; ch++) {
                    const off = dataOffset + (i * numChannels + ch) * 2;
                    const s = buf.readInt16LE(off);
                    sum += s;
                }
                const avg = Math.max(-32768, Math.min(32767, Math.floor(sum / numChannels)));
                monoSamples[i] = avg;
            }
            // Resample to 8000 Hz using linear interpolation
            const srcRate = sampleRate;
            const dstRate = 8000;
            const ratio = dstRate / srcRate;
            const outLen = Math.max(1, Math.floor(monoSamples.length * ratio));
            const ulawBytes = Buffer.alloc(outLen);
            for (let oi = 0; oi < outLen; oi++) {
                const srcIndex = oi / ratio; // map dst->src
                const i0 = Math.floor(srcIndex);
                const frac = srcIndex - i0;
                const s0 = monoSamples[i0] || 0;
                const s1 = monoSamples[i0 + 1] || s0;
                let s = s0 + frac * (s1 - s0);
                // Apply volume scalar
                s = Math.max(-32768, Math.min(32767, Math.floor(s * WAIT_MUSIC_VOLUME)));
                ulawBytes[oi] = linearToMuLaw(s);
            }
            return ulawBytes;
        }

        // Convert 16-bit PCM linear sample to 8-bit mu-law (PCMU)
        function linearToMuLaw(s16) {
            const CLIP = 32635;
            const BIAS = 0x84; // 132
            let sign = 0;
            if (s16 < 0) {
                sign = 0x80;
                s16 = -s16;
            }
            if (s16 > CLIP) s16 = CLIP;
            s16 = s16 + BIAS;
            let exponent = 7;
            for (let expMask = 0x4000; (s16 & expMask) === 0 && exponent > 0; expMask >>= 1) {
                exponent--;
            }
            const mantissa = (s16 >> (exponent + 3)) & 0x0F;
            let mu = ~(sign | (exponent << 4) | mantissa);
            return mu & 0xFF;
        }

        function startWaitingMusic() {
            if (!streamSid || isWaitingMusic) return;
            isWaitingMusic = true;
            // If audio file is provided and exists
            if (WAIT_MUSIC_FILE && fs.existsSync(WAIT_MUSIC_FILE)) {
                try {
                    if (WAIT_MUSIC_FILE.toLowerCase().endsWith('.wav')) {
                        // Parse WAV and pre-encode to µ-law buffer
                        waitingMusicUlawBuffer = parseWavToUlaw(WAIT_MUSIC_FILE);
                        waitingMusicOffset = 0;
                        if (!waitingMusicInterval) {
                            waitingMusicInterval = setInterval(() => {
                                if (!isWaitingMusic || !streamSid || !waitingMusicUlawBuffer || waitingMusicUlawBuffer.length < 160) return;
                                const frameSize = 160; // 20ms @ 8kHz mono
                                let end = waitingMusicOffset + frameSize;
                                let frame;
                                if (end <= waitingMusicUlawBuffer.length) {
                                    frame = waitingMusicUlawBuffer.subarray(waitingMusicOffset, end);
                                } else {
                                    const first = waitingMusicUlawBuffer.subarray(waitingMusicOffset);
                                    const rest = waitingMusicUlawBuffer.subarray(0, end - waitingMusicUlawBuffer.length);
                                    frame = Buffer.concat([first, rest]);
                                }
                                waitingMusicOffset = end % waitingMusicUlawBuffer.length;
                                const payload = frame.toString('base64');
                                connection.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
                            }, 20);
                        }
                    } else {
                        // Non-WAV files are not supported without ffmpeg; will fall back to tone
                    }
                } catch (e) {
                    console.error('Failed to load waiting music file, falling back to tone:', e);
                }
            }

            // No fallback tone; only WAV file is supported for waiting music.
        }

        function stopWaitingMusic() {
            if (waitingMusicStartTimeout) {
                clearTimeout(waitingMusicStartTimeout);
                waitingMusicStartTimeout = null;
            }
            if (isWaitingMusic) {
                isWaitingMusic = false;
            }
            // Remove unused buffer since ffmpeg is not used
            waitingMusicUlawBuffer = null;
            waitingMusicOffset = 0;
        }

        function clearWaitingMusicInterval() {
            if (waitingMusicInterval) {
                clearInterval(waitingMusicInterval);
                waitingMusicInterval = null;
            }
        }

        const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=${TEMPERATURE}`, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            }
        });

        // Helper to log and send tool errors to OpenAI WS
        function sendOpenAiToolError(callId, errorLike) {
            const msg = (typeof errorLike === 'string') ? errorLike : (errorLike?.message || String(errorLike));
            try {
                console.error('Sending tool error to OpenAI WS:', msg);
                const toolErrorEvent = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: callId,
                        output: JSON.stringify({ error: msg })
                    }
                };
                openAiWs.send(JSON.stringify(toolErrorEvent));
                openAiWs.send(JSON.stringify({ type: 'response.create' }));
            } catch (e) {
                console.error('Failed to send tool error to OpenAI WS:', e);
            }
        }

        // Define the gpt_web_search tool
        const gptWebSearchTool = {
            type: 'function',
            name: 'gpt_web_search',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: "The user's question or topic to research across the live web."
                    },
                    user_location: {
                        type: 'object',
                        description: 'Optional approximate user location to improve local relevance. Defaults to US Washington if not provided. When the user mentions a location, infer and include it here. Set type="approximate". If country is stated, use its two-letter code (e.g., US, FR); if not and the location is in the United States, default to US. Examples: "I am in Tucson Arizona" → region=Arizona, city=Tucson; "I will be in Paris, France" → region=Île-de-France, city=Paris.',
                        properties: {
                            type: { type: 'string', description: 'Location type; use "approximate".' },
                            country: { type: 'string', description: 'Two-letter country code like US.' },
                            region: { type: 'string', description: 'Region or state name.' },
                            city: { type: 'string', description: 'Optional city.' }
                        }
                    }
                },
                required: ['query']
            },
            description: 'Comprehensive web search'
        };

        // Define send_email tool
        const sendEmailTool = {
            type: 'function',
            name: 'send_email',
            parameters: {
                type: 'object',
                properties: {
                    subject: { type: 'string', description: 'Short subject summarizing the latest context.' },
                    body_html: { type: 'string', description: 'HTML-only email body composed from the latest conversation context. Include URLs when available, formatted as clickable links.' }
                },
                required: ['subject', 'body_html']
            },
            description: 'Send an HTML email with the latest context. The assistant must supply subject and HTML body that includes URLs when available.'
        };

        // Handle gpt_web_search tool calls
        const handleWebSearchToolCall = async (query, userLocation) => {
            try {
                const effectiveLocation = userLocation ?? {
                    type: "approximate",
                    country: "US",
                    region: "Washington"
                };

                // Build exact payload and log all values being sent to OpenAI
                const reqPayload = {
                    model: 'gpt-5.2',
                    reasoning: { effort: 'high' },
                    tools: [{
                        type: 'web_search',
                        user_location: effectiveLocation,
                    }],
                    instructions: WEB_SEARCH_INSTRUCTIONS,
                    input: query,
                    tool_choice: 'required',
                    truncation: 'auto',
                };

                if (IS_DEV) console.log('Web search request payload:', reqPayload);

                const result = await openaiClient.responses.create(reqPayload);

                if (IS_DEV) console.log('Web search result:', result.output_text);
                return result.output_text;
            } catch (error) {
                console.error('Error calling web search:', error);
                throw error;
            }
        };

        // Control initial session with OpenAI
        const initializeSession = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    type: 'realtime',
                    model: 'gpt-realtime',
                    output_modalities: ['audio'],
                    audio: {
                        input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'semantic_vad', eagerness: 'low', interrupt_response: true, create_response: true } },
                        output: { format: { type: 'audio/pcmu' }, voice: VOICE },
                    },
                    instructions: SYSTEM_MESSAGE,
                    tools: [ gptWebSearchTool, sendEmailTool ],
                    tool_choice: 'auto',
                },
            };

            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
        };

        // Handle interruption when the caller's speech starts
        const handleSpeechStartedEvent = () => {
            if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
                if (SHOW_TIMING_MATH) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);

                if (lastAssistantItem) {
                    const truncateEvent = {
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: elapsedTime
                    };
                    if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
                    openAiWs.send(JSON.stringify(truncateEvent));
                }

                connection.send(JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid
                }));

                // Reset
                markQueue = [];
                lastAssistantItem = null;
                responseStartTimestampTwilio = null;
            }
        };

        // Send mark messages to Media Streams so we know if and when AI response playback is finished
        const sendMark = (connection, streamSid) => {
            if (streamSid) {
                const markEvent = {
                    event: 'mark',
                    streamSid: streamSid,
                    mark: { name: 'responsePart' }
                };
                connection.send(JSON.stringify(markEvent));
                markQueue.push('responsePart');
            }
        };

        // Open event for OpenAI WebSocket
        openAiWs.on('open', () => {
            console.log('Connected to the OpenAI Realtime API');
            setTimeout(initializeSession, 100);
        });

        // Listen for messages from the OpenAI WebSocket (and send to Twilio if necessary)
        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);

                if (LOG_EVENT_TYPES.includes(response.type)) {
                    if (IS_DEV) console.log(`Received event: ${response.type}`, response);
                    else console.log(`Received event: ${response.type}`);
                }

                if (response.type === 'response.output_audio.delta' && response.delta) {
                    // Assistant audio is streaming; stop any waiting music immediately
                    stopWaitingMusic();
                    const audioDelta = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: response.delta }
                    };
                    connection.send(JSON.stringify(audioDelta));

                    // First delta from a new response starts the elapsed time counter
                    if (!responseStartTimestampTwilio) {
                        responseStartTimestampTwilio = latestMediaTimestamp;
                        if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
                    }

                    if (response.item_id) {
                        lastAssistantItem = response.item_id;
                    }
                    
                    sendMark(connection, streamSid);
                }

                if (response.type === 'input_audio_buffer.speech_started') {
                    // Caller barged in; stop waiting music and handle truncation
                    stopWaitingMusic();
                    handleSpeechStartedEvent();
                }

                // Handle function calls from response.done event
                if (response.type === 'response.done') {
                    const functionCall = response.response?.output?.[0];
                    if (IS_DEV) console.log('LLM response.done received');
                    
                    if (functionCall?.type === 'function_call') {
                        console.log('Function call detected:', functionCall.name);
                        
                        if (functionCall.name === 'gpt_web_search') {
                            // Schedule waiting music if the tool call takes longer than threshold
                            toolCallInProgress = true;
                            waitingMusicStartTimeout = setTimeout(() => {
                                if (toolCallInProgress) startWaitingMusic();
                            }, WAIT_MUSIC_THRESHOLD_MS);
                            try {
                                const toolInput = JSON.parse(functionCall.arguments);
                                const query = toolInput.query;
                                const userLocation = toolInput.user_location;
                                if (IS_DEV) console.log('Dev tool call gpt_web_search input:', { query, user_location: userLocation });
                                console.log(`Executing web search`);
                                handleWebSearchToolCall(query, userLocation)
                                    .then((searchResult) => {
                                        // Tool completed; stop waiting music before continuing response
                                        toolCallInProgress = false;
                                        stopWaitingMusic();
                                        clearWaitingMusicInterval();
                                        if (IS_DEV) console.log('Dev tool call gpt_web_search output:', searchResult);
                                        // Send function call output back to OpenAI
                                        const toolResultEvent = {
                                            type: 'conversation.item.create',
                                            item: {
                                                type: 'function_call_output',
                                                call_id: functionCall.call_id,
                                                output: JSON.stringify(searchResult)
                                            }
                                        };
                                        openAiWs.send(JSON.stringify(toolResultEvent));
                                        openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                        if (IS_DEV) console.log('LLM tool output sent to OpenAI');
                                    })
                                    .catch((error) => {
                                        console.error('Error handling web search tool call:', error);
                                        toolCallInProgress = false;
                                        stopWaitingMusic();
                                        clearWaitingMusicInterval();
                                        // Send error result back to OpenAI (and log)
                                        sendOpenAiToolError(functionCall.call_id, error);
                                    });
                            } catch (parseError) {
                                console.error('Error parsing tool arguments:', parseError);
                                toolCallInProgress = false;
                                stopWaitingMusic();
                                clearWaitingMusicInterval();
                            }
                        } else if (functionCall.name === 'send_email') {
                            try {
                                const toolInput = JSON.parse(functionCall.arguments);
                                const subjectRaw = String(toolInput.subject || '').trim();
                                const bodyHtml = String(toolInput.body_html || '').trim();
                                if (IS_DEV) console.log('Dev tool call send_email input:', { subject: subjectRaw, body_html: bodyHtml });

                                if (!subjectRaw || !bodyHtml) {
                                    const errMsg = 'Missing subject or body_html.';
                                    sendOpenAiToolError(functionCall.call_id, errMsg);
                                    return;
                                }

                                const subject = subjectRaw;

                                // Determine caller group
                                let group = null;
                                if (currentCallerE164 && PRIMARY_CALLERS_SET.has(currentCallerE164)) group = 'primary';
                                else if (currentCallerE164 && SECONDARY_CALLERS_SET.has(currentCallerE164)) group = 'secondary';

                                const fromEmail = SENDER_FROM_EMAIL || null;
                                const toEmail = group === 'primary' ? (PRIMARY_TO_EMAIL || null) : (group === 'secondary' ? (SECONDARY_TO_EMAIL || null) : null);

                                if (!senderTransport || !fromEmail || !toEmail) {
                                    const errMsg = 'Email is not configured for this caller.';
                                    sendOpenAiToolError(functionCall.call_id, errMsg);
                                    return;
                                }

                                // Send email
                                const mailOptions = {
                                    from: fromEmail,
                                    to: toEmail,
                                    subject,
                                    html: bodyHtml,
                                    headers: {
                                        'From-Ai-Assistant': 'true'
                                    }
                                };
                                if (IS_DEV) console.log('Dev sendMail options:', mailOptions);
                                senderTransport.sendMail(mailOptions).then((info) => {
                                    const result = {
                                        messageId: info.messageId,
                                        accepted: info.accepted,
                                        rejected: info.rejected,
                                    };
                                    if (IS_DEV) console.log('Dev tool call send_email output:', result);
                                    const toolResultEvent = {
                                        type: 'conversation.item.create',
                                        item: {
                                            type: 'function_call_output',
                                            call_id: functionCall.call_id,
                                            output: JSON.stringify(result)
                                        }
                                    };
                                    openAiWs.send(JSON.stringify(toolResultEvent));
                                    openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                    if (IS_DEV) console.log('LLM email tool output sent');
                                }).catch((error) => {
                                    console.error('Email send error:', error);
                                    sendOpenAiToolError(functionCall.call_id, error);
                                });
                            } catch (parseError) {
                                sendOpenAiToolError(functionCall.call_id, parseError);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error processing OpenAI message:', error, 'Raw message:', data);
            }
        });

        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        if (SHOW_TIMING_MATH) console.log(`Received media message with timestamp: ${latestMediaTimestamp}ms`);
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            openAiWs.send(JSON.stringify(audioAppend));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Incoming stream has started', streamSid);

                        // Reset start and media timestamp on a new stream
                        responseStartTimestampTwilio = null; 
                        latestMediaTimestamp = 0;
                        // Ensure waiting music is not running for a new stream
                        stopWaitingMusic();
                        clearWaitingMusicInterval();

                        // Read caller number from custom parameters passed via TwiML Parameter
                        try {
                            const cp = data.start?.customParameters || data.start?.custom_parameters || {};
                            const rawCaller = cp.caller_number || cp.callerNumber || null;
                            currentCallerE164 = normalizeUSNumberToE164(rawCaller);
                            if (currentCallerE164) console.log('Caller (from TwiML Parameter):', rawCaller, '=>', currentCallerE164);
                        } catch (e) {
                            console.warn('No custom caller parameter found on start event.');
                        }
                        break;
                    case 'mark':
                        if (markQueue.length > 0) {
                            markQueue.shift();
                        }
                        break;
                    default:
                        console.log('Received non-media event:', data.event);
                        break;
                }
            } catch (error) {
                console.error('Error parsing message:', error, 'Message:', message);
            }
        });

        // Handle connection close
        connection.on('close', () => {
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            stopWaitingMusic();
            clearWaitingMusicInterval();
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
            stopWaitingMusic();
            clearWaitingMusicInterval();
        });

        openAiWs.on('error', (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
            stopWaitingMusic();
            clearWaitingMusicInterval();
        });
    });
});

// Start server and establish ngrok ingress using SessionBuilder
(async () => {
    try {
        await fastify.listen({ host: '0.0.0.0', port: PORT });
        console.log(`HTTP server listening on 0.0.0.0:${PORT}`);

        // Optionally establish ngrok ingress if NGROK_DOMAIN is provided
        if (NGROK_DOMAIN) {
            if (!process.env.NGROK_AUTHTOKEN) {
                console.warn('Warning: NGROK_AUTHTOKEN is not set. Ensure ngrok is authenticated for domain binding.');
            }
            const session = await new ngrok.SessionBuilder().authtokenFromEnv().connect();
            const endpointBuilder = session.httpEndpoint().domain(NGROK_DOMAIN);
            console.log(`ngrok forwarding active on domain ${NGROK_DOMAIN}`);
            const listener = await endpointBuilder.listen();
            await listener.forward(`0.0.0.0:${PORT}`);
        } else {
            console.log('ngrok domain not configured; skipping ngrok setup.');
        }
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
