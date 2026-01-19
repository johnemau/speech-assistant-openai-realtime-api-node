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
import { inspect } from 'node:util';
import twilio from 'twilio';
import { createAssistantSession, safeParseToolArguments } from './src/assistant/session.js';
import { getToolDefinitions, executeToolCall } from './src/tools/index.js';
import { SYSTEM_MESSAGE, WEB_SEARCH_INSTRUCTIONS, SMS_REPLY_INSTRUCTIONS } from './src/assistant/prompts.js';

// Load environment variables from .env file
dotenv.config();

// Enable redaction of sensitive env vars from console and stdout
function isTruthy(val) {
    const v = String(val || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

// Helper: stringify objects for logging with deep nesting
function stringifyDeep(obj) {
    try {
        return inspect(obj, { depth: 10, colors: false, compact: false });
    } catch {
        try { return JSON.stringify(obj); } catch { return String(obj); }
    }
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
    'TWILIO_SMS_FROM_NUMBER',
    // Caller-related environment variables
    'PRIMARY_USER_PHONE_NUMBERS',
    'SECONDARY_USER_PHONE_NUMBERS',
    'PRIMARY_USER_FIRST_NAME',
    'SECONDARY_USER_FIRST_NAME',
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
// Skip entirely if DISABLE_LOG_REDACTION is truthy
if (!isTruthy(process.env.DISABLE_LOG_REDACTION)) {
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
            const secrets = Array.from(new Set([
                ...envSecretValues,
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
} else {
    console.warn('DISABLE_LOG_REDACTION is truthy; secret scrubber not initialized.');
}

// Retrieve required environment variables.
const { OPENAI_API_KEY, NGROK_DOMAIN, PRIMARY_USER_FIRST_NAME, SECONDARY_USER_FIRST_NAME } = process.env;
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY, TWILIO_API_SECRET } = process.env;

// Email-related environment variables
const {
    SENDER_FROM_EMAIL,
    SMTP_USER,
    SMTP_PASS,
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

// Initialize Twilio REST client (for SMS send/list). This is separate from the TwiML helper usage.
let twilioClient = null;
try {
    // Prefer API Key + Secret with Account SID (recommended by Twilio for production)
    if (TWILIO_API_KEY && TWILIO_API_SECRET && TWILIO_ACCOUNT_SID) {
        twilioClient = twilio(TWILIO_API_KEY, TWILIO_API_SECRET, { accountSid: TWILIO_ACCOUNT_SID });
        console.log('Twilio REST client initialized with API Key + Secret.');
    } else if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
        // Fallback: Account SID + Auth Token (best for local testing)
        twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        console.log('Twilio REST client initialized with Account SID + Auth Token.');
    } else {
        console.warn('Twilio credentials missing; provide API Key + Secret + Account SID or Account SID + Auth Token. SMS auto-reply will be unavailable.');
    }
} catch (e) {
    console.warn('Failed to initialize Twilio REST client:', e?.message || e);
}

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
const WAIT_MUSIC_THRESHOLD_MS = Number(process.env.WAIT_MUSIC_THRESHOLD_MS || 500);
const WAIT_MUSIC_VOLUME = Number(process.env.WAIT_MUSIC_VOLUME || 0.12); // 0.0 - 1.0
const WAIT_MUSIC_FILE = process.env.WAIT_MUSIC_FILE || null; // e.g., assets/wait-music.wav

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
const SHOW_TIMING_MATH = IS_DEV;

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Health Check Route (for Render/uptime monitors)
fastify.get('/healthz', async (request, reply) => {
    // Respond quickly with a 2xx to indicate instance is healthy
    reply.code(200).send({ status: 'ok' });
});

// SMS Webhook Route
// Responds with simple TwiML via Twilio MessagingResponse
fastify.post('/sms', async (request, reply) => {
    try {
        // Note: Global console wrappers already scrub sensitive data in logs.
        // No additional per-call redaction wrapper needed in this route.

        const { MessagingResponse } = twilio.twiml;
        const twiml = new MessagingResponse();

        const bodyRaw = request.body?.Body || request.body?.body || '';
        const fromRaw = request.body?.From || request.body?.from || '';
        const toRaw = request.body?.To || request.body?.to || '';

        const fromE164 = normalizeUSNumberToE164(fromRaw);
        const toE164 = normalizeUSNumberToE164(toRaw);
        // Concise incoming log
        console.info({
            event: 'sms.incoming',
            from: fromE164 || fromRaw || '',
            to: toE164 || toRaw || '',
            length: String(bodyRaw || '').length,
            preview: String(bodyRaw || '').slice(0, 160)
        });

        // Allowlist check: only PRIMARY or SECONDARY callers may use SMS auto-reply
        const isAllowed = !!fromE164 && (PRIMARY_CALLERS_SET.has(fromE164) || SECONDARY_CALLERS_SET.has(fromE164));
        if (!isAllowed) {
            // Concise log for restricted access
            console.warn({
                event: 'sms.reply.restricted_twiml',
                from: fromE164,
                to: toE164
            });
            twiml.message('Sorry, this SMS line is restricted.');
            return reply.type('text/xml').send(twiml.toString());
        }

        if (!twilioClient) {
            // Concise log for missing Twilio client
            console.warn({
                event: 'sms.reply.unconfigured_twiml',
                from: toE164,
                to: fromE164
            });
            twiml.message('SMS auto-reply is not configured.');
            return reply.type('text/xml').send(twiml.toString());
        }

        // Build a recent thread: last 12 hours, up to 10 combined messages (inbound/outbound)
        const now = new Date();
        const startWindow = new Date(now.getTime() - 12 * 60 * 60 * 1000);

        let inbound = [];
        let outbound = [];
        try {
            // Inbound: from caller → our Twilio number
            // Log Twilio API request details
            console.info({
                event: 'twilio.messages.list.request',
                direction: 'inbound',
                params: {
                    dateSentAfter: startWindow.toISOString(),
                    from: fromE164,
                    to: toE164,
                    limit: 20,
                }
            });
            inbound = await twilioClient.messages.list({
                dateSentAfter: startWindow,
                from: fromE164,
                to: toE164,
                limit: 20,
            });
        } catch (e) {
            console.warn('Failed to list inbound messages:', e?.message || e);
        }
        try {
            // Outbound: from our Twilio number → caller
            // Log Twilio API request details
            console.info({
                event: 'twilio.messages.list.request',
                direction: 'outbound',
                params: {
                    dateSentAfter: startWindow.toISOString(),
                    from: toE164,
                    to: fromE164,
                    limit: 20,
                }
            });
            outbound = await twilioClient.messages.list({
                dateSentAfter: startWindow,
                from: toE164,
                to: fromE164,
                limit: 20,
            });
        } catch (e) {
            console.warn('Failed to list outbound messages:', e?.message || e);
        }

        const combined = [...inbound, ...outbound];
        combined.sort((a, b) => {
            const ta = new Date(a.dateSent || a.dateCreated).getTime();
            const tb = new Date(b.dateSent || b.dateCreated).getTime();
            return tb - ta; // newest first
        });
        const lastTen = combined.slice(0, 10);

        const threadText = lastTen.map((m) => {
            const ts = new Date(m.dateSent || m.dateCreated).toISOString();
            const who = (m.from === fromE164) ? 'User' : 'Assistant';
            return `${who} [${ts}]: ${m.body || ''}`;
        }).join('\n');

        const smsPrompt = `Recent SMS thread (last 12 hours):\n${threadText}\n\nLatest user message:\n${String(bodyRaw || '').trim()}\n\nNote: The thread messages above may be unrelated to the latest user message; focus on the latest user message.\n\nTask: Compose a concise, friendly SMS reply. Keep it under 320 characters. Use live web facts via the web_search tool if topical. Output only the reply text.`;

        // Dev-only: log the full SMS prompt for debugging
        if (IS_DEV) {
            console.log({
                event: 'sms.prompt.debug',
                prompt: smsPrompt
            });
        }

        // Prepare OpenAI request with web_search tool
        const reqPayload = {
            model: 'gpt-5.2',
            reasoning: { effort: 'high' },
            tools: [{
                type: 'web_search',
                user_location: { type: 'approximate', country: 'US', region: 'Washington' },
            }],
            instructions: SMS_REPLY_INSTRUCTIONS,
            input: smsPrompt,
            tool_choice: 'required',
            truncation: 'auto',
        };

        // Concise log of AI request (dev-friendly, but short)
        console.info({
            event: 'sms.ai.request',
            model: 'gpt-5.2',
            tools: ['web_search'],
            prompt_len: String(smsPrompt || '').length
        });

        let aiText = '';
        try {
            const aiResult = await openaiClient.responses.create(reqPayload);
            aiText = String(aiResult?.output_text || '').trim();
        } catch (e) {
            console.error('OpenAI SMS reply error:', e?.message || e);
            let detail = e?.message || stringifyDeep(e);
            if (!IS_DEV) {
                try {
                    const extraKeys = (process.env.REDACT_ENV_KEYS || '')
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    const keys = Array.from(new Set([...DEFAULT_SECRET_ENV_KEYS, ...extraKeys]));
                    const envVals = [];
                    for (const k of keys) {
                        const v = process.env[k];
                        if (typeof v === 'string' && v.length > 0) envVals.push(v);
                    }
                    let guessed = [];
                    try { guessed = findSensitiveValues(e); } catch {}
                    const secrets = Array.from(new Set([...envVals, ...guessed]));
                    detail = scrub(detail, secrets);
                } catch {}
            }
            // Structured error log (redacted unless development)
            console.error({
                event: 'sms.reply.ai_error',
                from: fromE164,
                to: toE164,
                error: String(detail || '').slice(0, 220)
            });
            aiText = `Sorry—SMS reply error. Details: ${String(detail || '').slice(0, 220)}.`;
        }

        // Send the reply via Twilio API (from the same Twilio number the webhook hit)
        try {
            // Log Twilio API request details for SMS send
            console.info({
                event: 'twilio.messages.create.request',
                params: {
                    from: toE164,
                    to: fromE164,
                    length: String(aiText || '').length,
                    preview: String(aiText || '').slice(0, 160),
                }
            });
            const sendRes = await twilioClient.messages.create({
                from: toE164,
                to: fromE164,
                body: aiText,
            });
            // Always log SMS sends (with redaction unless development)
            const preview = String(aiText || '').slice(0, 160);
            console.info({
                event: 'sms.reply.sent',
                sid: sendRes?.sid,
                from: toE164,
                to: fromE164,
                length: String(aiText || '').length,
                preview,
            });
        } catch (e) {
            console.error('Failed to send Twilio SMS:', e?.message || e);
            // Fallback: reply via TwiML with redacted error details to ensure the user gets context
            let detail = e?.message || stringifyDeep(e);
            if (!IS_DEV) {
                try {
                    const extraKeys = (process.env.REDACT_ENV_KEYS || '')
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    const keys = Array.from(new Set([...DEFAULT_SECRET_ENV_KEYS, ...extraKeys]));
                    const envVals = [];
                    for (const k of keys) {
                        const v = process.env[k];
                        if (typeof v === 'string' && v.length > 0) envVals.push(v);
                    }
                    let guessed = [];
                    try { guessed = findSensitiveValues(e); } catch {}
                    const secrets = Array.from(new Set([...envVals, ...guessed]));
                    detail = scrub(detail, secrets);
                } catch {}
            }
            // Structured error log (redacted unless development)
            console.error({
                event: 'sms.reply.send_error',
                from: toE164,
                to: fromE164,
                error: String(detail || '').slice(0, 220)
            });
            const fallbackMsg = `Sorry—SMS send error. Details: ${String(detail || '').slice(0, 220)}.`;
            // Log fallback TwiML generation
            console.warn({
                event: 'sms.reply.fallback_twiml',
                from: toE164,
                to: fromE164,
                preview: String(fallbackMsg).slice(0, 160)
            });
            twiml.message(fallbackMsg);
            return reply.type('text/xml').send(twiml.toString());
        }

        // Return empty TwiML to avoid duplicate auto-replies
        console.info({
            event: 'sms.webhook.completed',
            from: toE164,
            to: fromE164
        });
        return reply.type('text/xml').send(twiml.toString());
    } catch (e) {
        // Concise structured unhandled error
        console.error({
            event: 'sms.webhook.unhandled_error',
            error: (e?.message || String(e || '')).slice(0, 220)
        });
        return reply.code(500).send('');
    }
});

// Route for Twilio to handle incoming calls
// <Say> punctuation to improve text-to-speech translation
fastify.all('/incoming-call', async (request, reply) => {
    const fromRaw = request.body?.From || request.body?.from || request.body?.Caller;
    const fromE164 = normalizeUSNumberToE164(fromRaw);
    const toRaw = request.body?.To || request.body?.to || '';
    const toE164 = normalizeUSNumberToE164(toRaw);
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
    const primaryName = (PRIMARY_USER_FIRST_NAME || '').trim();
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
                              <Say voice="Google.en-US-Chirp3-HD-Charon">${timeGreeting} ${callerName}. Connecting to your AI assistant momentarily.</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream">
                                      <Parameter name="caller_number" value="${fromE164}" />
                                      <Parameter name="twilio_number" value="${toE164 || ''}" />
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
        let currentTwilioNumberE164 = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;
        let pendingDisconnect = false;
        let pendingDisconnectTimeout = null;

        // Track response lifecycle to avoid overlapping response.create calls
        let responseActive = false;

        // Post-hang-up behavior: suppress audio, continue tools, then SMS
        let postHangupSilentMode = false; // when true, do not send any audio back to Twilio
        let postHangupSmsSent = false;    // ensure the completion SMS is sent at most once
        let lastWebSearchQuery = null;    // capture recent query to summarize
        let lastEmailSubject = null;      // capture subject to summarize
        let hangupDuringTools = false;    // true if caller hung up while tools were pending/active

        // Mic distance / noise reduction state & counters
        const micState = {
            currentNoiseReductionType: 'near_field',
            lastMicDistanceToggleTs: 0,
            farToggles: 0,
            nearToggles: 0,
            skippedNoOp: 0,
        };

        // Waiting music state
        let isWaitingMusic = false;
        let waitingMusicInterval = null;
        let waitingMusicStartTimeout = null;
        let toolCallInProgress = false;
        // Track the very first assistant audio to stop initial wait music
        let firstAssistantAudioReceived = false;
        // ffmpeg removed; we only support WAV files; no tone fallback
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

        function startWaitingMusic(reason = 'unknown') {
            if (!streamSid || isWaitingMusic) return;
            isWaitingMusic = true;
            try {
                console.info({
                    event: 'wait_music.start',
                    reason,
                    streamSid,
                    threshold_ms: WAIT_MUSIC_THRESHOLD_MS,
                    file: WAIT_MUSIC_FILE || null
                });
            } catch {}
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
                        // Non-WAV files are not supported without ffmpeg; waiting music disabled
                        console.warn({ event: 'wait_music.unsupported_file', file: WAIT_MUSIC_FILE });
                    }
                } catch (e) {
                    console.error('Failed to load waiting music file; disabling waiting music:', e?.message || e);
                }
            }

            // No fallback tone; only WAV file is supported for waiting music.
        }

        function stopWaitingMusic(reason = 'unknown') {
            if (waitingMusicStartTimeout) {
                clearTimeout(waitingMusicStartTimeout);
                waitingMusicStartTimeout = null;
            }
            if (isWaitingMusic) {
                isWaitingMusic = false;
                try {
                    console.info({ event: 'wait_music.stop', reason, streamSid });
                } catch {}
            }
            // Remove unused buffer since ffmpeg is not used
            waitingMusicUlawBuffer = null;
            waitingMusicOffset = 0;
            // Ensure any playback interval is cleared
            clearWaitingMusicInterval();
        }

        function clearWaitingMusicInterval() {
            if (waitingMusicInterval) {
                clearInterval(waitingMusicInterval);
                waitingMusicInterval = null;
            }
        }

        function attemptPendingDisconnectClose() {
            try {
                if (!pendingDisconnect) return;
                // Prefer closing after Twilio marks catch up (no queued marks)
                if (markQueue.length === 0) {
                    pendingDisconnect = false;
                    if (pendingDisconnectTimeout) {
                        clearTimeout(pendingDisconnectTimeout);
                        pendingDisconnectTimeout = null;
                    }
                    stopWaitingMusic();
                    clearWaitingMusicInterval();
                    try { connection.close(1000, 'Call ended by assistant'); } catch {}
                    try { if (assistantSession.openAiWs?.readyState === WebSocket.OPEN) assistantSession.close(); } catch {}
                    console.log('Call closed after goodbye playback.');
                }
            } catch (e) {
                console.warn('Attempt to close pending disconnect failed:', e?.message || e);
            }
        }

        const handleAssistantOutput = (payload) => {
            if (payload?.type !== 'audio' || !payload?.delta) return;
            // Suppress audio entirely after hang-up; otherwise, stream to Twilio
            // Mark that the assistant has started speaking (first-time check)
            if (!firstAssistantAudioReceived) firstAssistantAudioReceived = true;
            // Assistant audio is streaming; stop any waiting music immediately
            stopWaitingMusic('assistant_audio');
            if (!postHangupSilentMode) {
                const audioDelta = {
                    event: 'media',
                    streamSid: streamSid,
                    media: { payload: payload.delta }
                };
                connection.send(JSON.stringify(audioDelta));

                // First delta from a new response starts the elapsed time counter
                if (!responseStartTimestampTwilio) {
                    responseStartTimestampTwilio = latestMediaTimestamp;
                    if (SHOW_TIMING_MATH) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
                }

                if (payload.itemId) {
                    lastAssistantItem = payload.itemId;
                }
                
                sendMark(connection, streamSid);
            }
        };

        const handleOpenAiEvent = (response) => {
            if (LOG_EVENT_TYPES.includes(response.type)) {
                if (IS_DEV) console.log(`Received event: ${response.type}`, response);
                else console.log(`Received event: ${response.type}`);
            }

            // Track response lifecycle to avoid overlapping creates
            if (response.type === 'response.created') {
                responseActive = true;
            }
            if (response.type === 'response.done') {
                responseActive = false;
            }

            // When VAD ends a user turn, we must explicitly create a response (auto-create disabled)
            if (response.type === 'input_audio_buffer.speech_stopped') {
                stopWaitingMusic('speech_stopped');
                if (!responseActive) {
                    try {
                        assistantSession.requestResponse();
                    } catch (e) {
                        console.warn('Failed to request response.create after speech_stopped:', e?.message || e);
                    }
                }
            }

            if (response.type === 'input_audio_buffer.speech_started') {
                // Caller barged in; stop waiting music and handle truncation
                stopWaitingMusic('caller_speech');
                handleSpeechStartedEvent();
            }

            if (response.type === 'response.done') {
                const functionCall = response.response?.output?.[0];
                if (!functionCall || functionCall?.type !== 'function_call') {
                    // Non-function responses: if we were asked to end the call, close after playback finishes
                    attemptPendingDisconnectClose();
                    // If in silent mode and no tool call is active, send a completion SMS and close OpenAI WS
                    if (postHangupSilentMode && hangupDuringTools && !toolCallInProgress && !postHangupSmsSent) {
                        try {
                            const toNumber = currentCallerE164;
                            const envFrom = normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER || '');
                            const fromNumber = currentTwilioNumberE164 || envFrom;
                            if (twilioClient && toNumber && fromNumber) {
                                const subjectNote = lastEmailSubject ? ` Email sent: "${lastEmailSubject}".` : '';
                                const body = `Your request is complete.${subjectNote} Reply if you want more.`;
                                if (IS_DEV) console.log('Post-hang-up completion SMS:', { from: fromNumber, to: toNumber, body });
                                twilioClient.messages.create({ from: fromNumber, to: toNumber, body })
                                    .then((sendRes) => {
                                        console.info({ event: 'posthangup.sms.sent', sid: sendRes?.sid, to: toNumber });
                                    })
                                    .catch((e) => {
                                        console.warn('Post-hang-up SMS send error:', e?.message || e);
                                    });
                                postHangupSmsSent = true;
                            } else {
                                console.warn({ event: 'posthangup.sms.unavailable', to: toNumber, from: fromNumber });
                            }
                        } catch (e) {
                            console.warn('Post-hang-up SMS error:', e?.message || e);
                        }
                        // Close OpenAI WS after completion notification
                        try { if (assistantSession.openAiWs?.readyState === WebSocket.OPEN) assistantSession.close(); } catch {}
                    }
                }
            }
        };

        const handleToolCall = async (functionCall) => {
            if (IS_DEV) console.log('LLM response.done received');
            console.log('Function call detected:', functionCall.name);
            const callId = functionCall.call_id;
            if (!callId) {
                console.warn('Function call missing call_id; skipping to prevent duplicate execution.');
                return;
            }

            const toolName = functionCall.name;
            const shouldUseWaitingMusic = toolName !== 'end_call';
            if (shouldUseWaitingMusic) {
                toolCallInProgress = true;
                waitingMusicStartTimeout = setTimeout(() => {
                    if (toolCallInProgress) startWaitingMusic();
                }, WAIT_MUSIC_THRESHOLD_MS);
            } else {
                toolCallInProgress = true;
            }

            try {
                const toolInput = safeParseToolArguments(functionCall.arguments);
                if (postHangupSilentMode) hangupDuringTools = true;
                if (toolName === 'gpt_web_search') {
                    lastWebSearchQuery = toolInput?.query || lastWebSearchQuery;
                }
                if (toolName === 'send_email') {
                    const subjectRaw = String(toolInput?.subject || '').trim();
                    if (subjectRaw) lastEmailSubject = subjectRaw;
                }

                const toolContext = {
                    openaiClient,
                    twilioClient,
                    senderTransport,
                    env: process.env,
                    normalizeUSNumberToE164,
                    primaryCallersSet: PRIMARY_CALLERS_SET,
                    secondaryCallersSet: SECONDARY_CALLERS_SET,
                    currentCallerE164,
                    currentTwilioNumberE164,
                    webSearchInstructions: WEB_SEARCH_INSTRUCTIONS,
                    defaultUserLocation: { type: 'approximate', country: 'US', region: 'Washington' },
                    allowLiveSideEffects: true,
                    micState,
                    applyNoiseReduction: (mode) => {
                        const sessionUpdate = {
                            audio: {
                                input: {
                                    noise_reduction: { type: mode }
                                }
                            }
                        };
                        if (IS_DEV) console.log('Applying noise_reduction change:', sessionUpdate);
                        assistantSession.updateSession(sessionUpdate);
                    },
                    onEndCall: ({ reason }) => {
                        // Enter silent mode: do not send any audio; allow tools to finish
                        postHangupSilentMode = true;
                        pendingDisconnect = true;
                        if (toolCallInProgress) hangupDuringTools = true;
                        // Close the Twilio stream promptly; keep OpenAI WS alive for tools
                        try { connection.close(1000, 'Call ended by assistant'); } catch {}
                        return {
                            status: 'ok',
                            pending_disconnect: true,
                            reason,
                            silent: true
                        };
                    }
                };

                const output = await executeToolCall({ name: toolName, args: toolInput, context: toolContext });

                if (toolName === 'update_mic_distance') {
                    if (IS_DEV) console.log('Noise reduction updated:', output);
                }

                if (toolName === 'gpt_web_search' && IS_DEV) {
                    console.log('Dev tool call gpt_web_search output:', output);
                }

                const toolResultEvent = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: functionCall.call_id,
                        output: JSON.stringify(output)
                    }
                };
                toolCallInProgress = false;
                stopWaitingMusic('tool_call_complete');
                clearWaitingMusicInterval();
                assistantSession.send(toolResultEvent);
                if (!responseActive) assistantSession.requestResponse();
                if (IS_DEV) console.log('LLM tool output sent to OpenAI', toolResultEvent);
            } catch (error) {
                console.error('Error handling tool call:', error);
                toolCallInProgress = false;
                stopWaitingMusic('tool_error');
                clearWaitingMusicInterval();
                sendOpenAiToolError(functionCall.call_id, error);
            }
        };

        const assistantSession = createAssistantSession({
            apiKey: OPENAI_API_KEY,
            model: 'gpt-realtime',
            temperature: TEMPERATURE,
            voice: VOICE,
            instructions: SYSTEM_MESSAGE,
            tools: getToolDefinitions(),
            outputModalities: ['audio'],
            audioConfig: {
                input: {
                    format: { type: 'audio/pcmu' },
                    turn_detection: { type: 'semantic_vad', eagerness: 'low', interrupt_response: true, create_response: false },
                    noise_reduction: { type: micState.currentNoiseReductionType }
                },
                output: { format: { type: 'audio/pcmu' }, voice: VOICE },
            },
            onEvent: handleOpenAiEvent,
            onAssistantOutput: handleAssistantOutput,
            onToolCall: handleToolCall,
            onOpen: () => console.log('Connected to the OpenAI Realtime API'),
            onClose: () => {
                console.log('Disconnected from the OpenAI Realtime API');
                stopWaitingMusic();
                clearWaitingMusicInterval();
            },
            onError: (error) => {
                console.error('Error in the OpenAI WebSocket:', error);
                stopWaitingMusic();
                clearWaitingMusicInterval();
            }
        });

        // Send initial conversation item using the caller's name once available
        const sendInitialConversationItem = (callerNameValue = 'legend') => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: `Greet the caller in English with a single, concise, butler/service‑worker style line that politely addresses them as "${callerNameValue}" and is similar to "At your service ${callerNameValue}, how may I help?". Keep it light and optionally witty; always include the name.`
                        }
                    ]
                }
            };

            if (SHOW_TIMING_MATH) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem));
            assistantSession.send(initialConversationItem);
            assistantSession.requestResponse();
        };

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
                assistantSession.send(toolErrorEvent);
                if (!responseActive) assistantSession.requestResponse();
            } catch (e) {
                console.error('Failed to send tool error to OpenAI WS:', e);
            }
        }

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
                    if (SHOW_TIMING_MATH) console.log('Sending truncation event:', stringifyDeep(truncateEvent));
                    assistantSession.send(truncateEvent);
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


        // Handle incoming messages from Twilio
        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        const audioAppend = {
                            type: 'input_audio_buffer.append',
                            audio: data.media.payload
                        };
                        assistantSession.send(audioAppend);
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Incoming stream has started', streamSid);

                        // Reset start and media timestamp on a new stream
                        responseStartTimestampTwilio = null; 
                        latestMediaTimestamp = 0;
                        // Ensure waiting music is not running for a new stream
                        stopWaitingMusic('new_stream');
                        clearWaitingMusicInterval();

                        // Read caller number from custom parameters passed via TwiML Parameter
                        try {
                            const cp = data.start?.customParameters || data.start?.custom_parameters || {};
                            const rawCaller = cp.caller_number || cp.callerNumber || null;
                            currentCallerE164 = normalizeUSNumberToE164(rawCaller);
                            if (currentCallerE164) console.log('Caller (from TwiML Parameter):', rawCaller, '=>', currentCallerE164);
                            const rawTwilioNum = cp.twilio_number || cp.twilioNumber || null;
                            currentTwilioNumberE164 = normalizeUSNumberToE164(rawTwilioNum);
                            if (currentTwilioNumberE164) console.log('Twilio number (from TwiML Parameter):', rawTwilioNum, '=>', currentTwilioNumberE164);
                            // Compute caller name based on group and send initial greeting
                            const primaryName = String(PRIMARY_USER_FIRST_NAME || '').trim();
                            const secondaryName = String(SECONDARY_USER_FIRST_NAME || '').trim();
                            let callerName = 'legend';
                            if (currentCallerE164 && PRIMARY_CALLERS_SET.has(currentCallerE164) && primaryName) {
                                callerName = primaryName;
                            } else if (currentCallerE164 && SECONDARY_CALLERS_SET.has(currentCallerE164) && secondaryName) {
                                callerName = secondaryName;
                            }
                            // Send the personalized greeting to OpenAI to speak first
                            sendInitialConversationItem(callerName);
                            // Start initial wait music until first assistant audio, after a small threshold
                            if (!firstAssistantAudioReceived) {
                                waitingMusicStartTimeout = setTimeout(() => {
                                    if (!firstAssistantAudioReceived && !isWaitingMusic) startWaitingMusic('initial');
                                }, WAIT_MUSIC_THRESHOLD_MS);
                            }
                        } catch {
                            console.warn('No custom caller parameter found on start event.');
                            // Fallback greeting without a personalized name
                            sendInitialConversationItem('legend');
                            // Start initial wait music even without a personalized name
                            if (!firstAssistantAudioReceived) {
                                waitingMusicStartTimeout = setTimeout(() => {
                                    if (!firstAssistantAudioReceived && !isWaitingMusic) startWaitingMusic('initial');
                                }, WAIT_MUSIC_THRESHOLD_MS);
                            }
                        }
                        break;
                    case 'mark':
                        if (markQueue.length > 0) {
                            markQueue.shift();
                        }
                        // If a disconnect was requested, attempt closing once marks drain
                        attemptPendingDisconnectClose();
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
            // Enter silent mode and continue tool execution without streaming audio
            postHangupSilentMode = true;
            if (toolCallInProgress) hangupDuringTools = true;
            if (pendingDisconnectTimeout) {
                clearTimeout(pendingDisconnectTimeout);
                pendingDisconnectTimeout = null;
            }
            responseActive = false;
            // Clear any queued messages on close
            assistantSession.clearPendingMessages?.();
            stopWaitingMusic();
            clearWaitingMusicInterval();
            console.log('Client disconnected; silent mode enabled. Continuing tools and will notify via SMS.');
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
