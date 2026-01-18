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
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

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

// Initialize Twilio REST client (for SMS send/list). This is separate from the TwiML helper usage.
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try {
        twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        console.log('Twilio REST client initialized.');
    } catch (e) {
        console.warn('Failed to initialize Twilio REST client:', e?.message || e);
    }
} else {
    console.warn('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing; SMS auto-reply feature will be unavailable.');
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

// Send a one-time test email to the PRIMARY user when the server starts
async function sendStartupTestEmail() {
    try {
        if (!senderTransport || !SENDER_FROM_EMAIL || !PRIMARY_TO_EMAIL) {
            console.warn('Skipping startup test email; missing email configuration.');
            return;
        }

        const primaryName = String(process.env.PRIMARY_USER_FIRST_NAME || '').trim();
        const greeting = primaryName ? `Hi ${primaryName},` : 'Hello,';
        const html = `<!DOCTYPE html>
<html>
  <body>
    <p>${greeting}</p>
    <p>Your Twilio Media Stream server has started successfully.</p>
    <p>This is an automatic test email sent on startup.</p>
    <hr />
    <p style="font-family: monospace; line-height: 1.2; margin-top: 12px;">\n      /\\_/\\\n     ( •.• )\n      > ^ <\n    </p>
  </body>
</html>`;

        const mailOptions = {
            from: SENDER_FROM_EMAIL,
            to: PRIMARY_TO_EMAIL,
            subject: 'Server started — Test Email',
            html,
            headers: { 'X-Startup-Test': 'true' }
        };

        const info = await senderTransport.sendMail(mailOptions);
        console.log('Startup test email sent to PRIMARY user.', { messageId: info?.messageId });
    } catch (err) {
        console.warn('Failed to send startup test email:', err?.message || err);
    }
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
 - Provide a short, clear 'subject' and 'body_html' containing an HTML-only body. Include specific details the caller requested and, when available, include links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. Links must be clickable URLs.
- The email body must be non-conversational: do not include follow-up questions (e.g., "would you like me to do x?"). Ensure the information is formatted for readability and kept concise.
- Always conclude the email with a small, cute ASCII art on a new line.
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

# Personality & Tone
## Personality
- Friendly, calm and approachable expert assistant.
## Tone
- Warm, concise, confident, never fawning.
## Pacing
- Deliver your audio response fast, but do not sound rushed.
- Do not modify the content of your response, only increase speaking speed for the same response.

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
 
# Speakerphone Handling
- If the caller says “you’re on speaker”, “putting you on speaker phone”, or similar → call the tool update_mic_distance with mode="far_field".
- If the caller says “connected to car bluetooth”, “you are on the car”, “car speakers”, or similar → call update_mic_distance with mode="far_field".
- If the caller says “taking you off speaker phone”, “off speaker”, “taking off car”, “off bluetooth”, or similar → call update_mic_distance with mode="near_field".
- Make at most one tool call per user turn; avoid repeating the same mode.
- After receiving the tool result, speak one brief confirmation (e.g., “Optimizing for speakerphone.” or “Back to near‑field.”).
- Respect negations or corrections (e.g., “not on speaker”, “no, keep it near”).

# Call Ending
- If the caller says “hang up”, “goodbye”, “bye now”, “disconnect”, or “end the call” → call the tool named end_call.
- After receiving the tool result, speak one brief goodbye (e.g., “Goodbye.”). The server will end the call immediately after playback finishes.
- Make at most one tool call per user turn and respect negations (e.g., “don’t hang up”).
`;
// Instructions for web-search `responses.create` to produce detailed, voice-friendly output
const WEB_SEARCH_INSTRUCTIONS = 'Prepare a voice-ready answer for a live call using gpt-realtime. Provide a detailed, fact-rich response that is easy to follow over the phone. Prioritize useful, actionable facts and omit filler. When relevant (e.g., a business), include the name, address, phone number, hours (if available), and review score. Present information in clear, short sentences or brief phrases that are easy to hear. Do not include URLs. Include concise source labels only (for example: "Source: Yelp" or "Source: Reuters"). Use natural phrasing and readable pacing for speech.';
const VOICE = 'cedar';
const TEMPERATURE = 0.8; // Controls the randomness of the AI's responses
const PORT = process.env.PORT || 10000; // Render default PORT is 10000

// Instructions tailored for SMS replies
const SMS_REPLY_INSTRUCTIONS = 'You are an SMS assistant. Take the latest user message and compose a single concise reply. Always call the web_search tool first to check for up-to-date facts relevant to the query, and base any factual content strictly on its results. Prefer brevity and clarity. Keep the reply ≤320 characters, friendly, and actionable. Include at most one short source label (e.g., "Source: Reuters"). Include URLs only when they are directly helpful (e.g., official page, business website, specific article). Avoid filler and preambles. Output only the SMS body text, no quotes.';

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
        // Helper: redact log payload unless running in development
        const redactLog = (val) => {
            if (IS_DEV) return val;
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
                try { guessed = findSensitiveValues(val); } catch {}
                const secrets = Array.from(new Set([...envVals, ...guessed]));
                return scrub(val, secrets);
            } catch {
                return val;
            }
        };

        const { MessagingResponse } = twilio.twiml;
        const twiml = new MessagingResponse();

        const bodyRaw = request.body?.Body || request.body?.body || '';
        const fromRaw = request.body?.From || request.body?.from || '';
        const toRaw = request.body?.To || request.body?.to || '';

        const fromE164 = normalizeUSNumberToE164(fromRaw);
        const toE164 = normalizeUSNumberToE164(toRaw);
        if (IS_DEV) console.log('Incoming SMS:', { from: fromRaw, to: toRaw, body: bodyRaw, fromE164, toE164 });

        // Allowlist check: only PRIMARY or SECONDARY callers may use SMS auto-reply
        const isAllowed = !!fromE164 && (PRIMARY_CALLERS_SET.has(fromE164) || SECONDARY_CALLERS_SET.has(fromE164));
        if (!isAllowed) {
            twiml.message('Sorry, this SMS line is restricted.');
            return reply.type('text/xml').send(twiml.toString());
        }

        if (!twilioClient) {
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

        const smsPrompt = `Recent SMS thread (last 12 hours):\n${threadText}\n\nLatest user message:\n${String(bodyRaw || '').trim()}\n\nTask: Compose a concise, friendly SMS reply. Keep it under 320 characters. Use live web facts via the web_search tool if topical. Output only the reply text.`;

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

        if (IS_DEV) console.log('SMS OpenAI payload:', reqPayload);

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
            console.error(redactLog({
                event: 'sms.reply.ai_error',
                from: fromE164,
                to: toE164,
                error: String(detail || '').slice(0, 220)
            }));
            aiText = `Sorry—there was an error while creating your AI SMS reply using GPT-5.2 with web_search. Details: ${String(detail || '').slice(0, 220)}. Please try again shortly.`;
        }

        // Send the reply via Twilio API (from the same Twilio number the webhook hit)
        try {
            const sendRes = await twilioClient.messages.create({
                from: toE164,
                to: fromE164,
                body: aiText,
            });
            // Always log SMS sends (with redaction unless development)
            const preview = String(aiText || '').slice(0, 160);
            console.info(redactLog({
                event: 'sms.reply.sent',
                sid: sendRes?.sid,
                from: toE164,
                to: fromE164,
                length: String(aiText || '').length,
                preview,
            }));
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
            console.error(redactLog({
                event: 'sms.reply.send_error',
                from: toE164,
                to: fromE164,
                error: String(detail || '').slice(0, 220)
            }));
            const fallbackMsg = `Sorry—there was an error sending your SMS reply via Twilio API. Details: ${String(detail || '').slice(0, 220)}.`;
            // Log fallback TwiML generation
            console.warn(redactLog({
                event: 'sms.reply.fallback_twiml',
                from: toE164,
                to: fromE164,
                preview: String(fallbackMsg).slice(0, 160)
            }));
            twiml.message(fallbackMsg);
            return reply.type('text/xml').send(twiml.toString());
        }

        // Return empty TwiML to avoid duplicate auto-replies
        return reply.type('text/xml').send(twiml.toString());
    } catch (e) {
        console.error('Error handling /sms webhook:', e?.message || e);
        return reply.code(500).send('');
    }
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
        let pendingDisconnect = false;
        let pendingDisconnectTimeout = null;

        // Mic distance / noise reduction state & counters
        let currentNoiseReductionType = 'near_field';
        let lastMicDistanceToggleTs = 0;
        let farToggles = 0;
        let nearToggles = 0;
        let skippedNoOp = 0;

        // Waiting music state
        let isWaitingMusic = false;
        let waitingMusicInterval = null;
        let waitingMusicStartTimeout = null;
        let toolCallInProgress = false;
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
                        // Non-WAV files are not supported without ffmpeg; waiting music disabled
                    }
                } catch (e) {
                    console.error('Failed to load waiting music file; disabling waiting music:', e);
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
                    try { if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close(); } catch {}
                    console.log('Call closed after goodbye playback.');
                }
            } catch (e) {
                console.warn('Attempt to close pending disconnect failed:', e?.message || e);
            }
        }

        const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=${TEMPERATURE}`, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            }
        });

        // Queue outbound OpenAI messages until the WS is OPEN
        const pendingOpenAiMessages = [];
        function openAiSend(obj) {
            try {
                const payload = JSON.stringify(obj);
                if (openAiWs.readyState === WebSocket.OPEN) {
                    openAiWs.send(payload);
                } else {
                    pendingOpenAiMessages.push(payload);
                }
            } catch (e) {
                console.error('Failed to send/queue OpenAI message:', e);
            }
        }
        function flushPendingOpenAiMessages() {
            if (openAiWs.readyState !== WebSocket.OPEN) return;
            try {
                while (pendingOpenAiMessages.length > 0) {
                    const msg = pendingOpenAiMessages.shift();
                    openAiWs.send(msg);
                }
            } catch (e) {
                console.error('Failed to flush OpenAI queued messages:', e);
            }
        }

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
            openAiSend(initialConversationItem);
            openAiSend({ type: 'response.create' });
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
                                        body_html: {
                                                type: 'string',
                                                description: 'HTML-only email body composed from the latest conversation context. Non-conversational (no follow-up questions); formatted for readability and concise. Include specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be provided as clickable URLs. Always conclude with a small, cute ASCII art at the end of the message.',
                                                examples: [
                                                        `<html>
    <body>
        <h2>Bluebird Cafe — Seattle, WA</h2>

        <p><strong>Address:</strong> 123 Pine St, Seattle, WA 98101</p>
        <p><strong>Phone:</strong> <a href="tel:+12065550123">+1 (206) 555‑0123</a></p>
        <p><strong>Email:</strong> <a href="mailto:info@bluebirdcafe.example">info@bluebirdcafe.example</a></p>
        <p><strong>Website:</strong> <a href="https://bluebirdcafe.example">https://bluebirdcafe.example</a></p>
        <p><strong>Google Maps:</strong> <a href="https://maps.google.com/?q=Bluebird%20Cafe%20123%20Pine%20St%20Seattle%20WA%2098101">View location</a></p>

        <h3>Hours of Operation</h3>
        <ul>
            <li>Mon–Fri: 7:00 AM – 6:00 PM</li>
            <li>Sat: 8:00 AM – 6:00 PM</li>
            <li>Sun: 8:00 AM – 4:00 PM</li>
        </ul>

        <h3>Quick Highlights</h3>
        <ul>
            <li>Specialty: Single‑origin pour‑overs and seasonal pastries.</li>
            <li>Amenities: Free Wi‑Fi, indoor seating, pet‑friendly patio.</li>
        </ul>

        <h3>Recent Coverage</h3>
        <ul>
            <li><a href="https://news.example.com/2026/bluebird-cafe-feature">Feature article on Bluebird Cafe</a></li>
            <li><a href="https://blog.example.com/seattle-best-coffee-2026">Seattle coffee roundup (includes Bluebird)</a></li>
        </ul>

        <hr />

        <pre style="font-family: monospace; line-height: 1.2; margin-top: 12px;">
            /\_/\
         ( •.• )  meow
            > ^ <
        </pre>
    </body>
</html>`,
                                                        `<html>
    <body>
        <h2>U.S. President — Quick Fact</h2>
        <p><strong>Current President:</strong> Example Name.</p>
        <p><em>Source:</em> <a href="https://www.whitehouse.gov/">whitehouse.gov</a></p>
        <hr />
        <pre style="font-family: monospace; line-height: 1.2; margin-top: 12px;">
            ʕ•ᴥ•ʔ
        </pre>
    </body>
</html>`,
                                                        `<html>
    <body>
        <h2>24‑Hour Weather — Seattle, WA</h2>
        <p><strong>Forecast:</strong> Showers early, clearing late. High 49°F / Low 41°F. Winds SW 5–10 mph.</p>
        <p><em>Source:</em> <a href="https://forecast.weather.gov/MapClick.php?textField1=47.61&textField2=-122.33">National Weather Service</a></p>
        <hr />
        <pre style="font-family: monospace; line-height: 1.2; margin-top: 12px;">
            (•‿•)
        </pre>
    </body>
</html>`,
                                                        `<html>
    <body>
        <h2>Movie Showtimes — Tonight</h2>
        <p><strong>Regal Pine Street 12</strong><br />
             456 Pine St, Seattle, WA 98101 — <a href="https://maps.google.com/?q=Regal%20Pine%20Street%2012%20Seattle">Google Maps</a><br />
             Phone: <a href="tel:+12065550111">+1 (206) 555‑0111</a> — Website: <a href="https://www.regal.example/pine-street-12">regal.example/pine-street-12</a></p>
        <ul>
            <li>Starlight Odyssey (PG‑13): 6:45 PM, 9:15 PM</li>
            <li>City Beats (R): 7:00 PM, 9:30 PM</li>
            <li>Green Trails (PG): 6:30 PM</li>
        </ul>
        <hr />
        <pre style="font-family: monospace; line-height: 1.2; margin-top: 12px;">
            /\_/\
         ( •.• )
            > ^ <
        </pre>
    </body>
</html>`
                                                ]
                                        }
                },
                required: ['subject', 'body_html']
            },
            description: 'Send an HTML email with the latest context. The assistant must supply a subject and a non-conversational, concise HTML body that includes specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be clickable URLs. Always conclude the email with a small, cute ASCII art at the end.'
        };

        // Define update_mic_distance tool (near_field | far_field)
        const updateMicDistanceTool = {
            type: 'function',
            name: 'update_mic_distance',
            parameters: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        enum: ['near_field', 'far_field'],
                        description: 'Set input noise_reduction.type to near_field or far_field.'
                    },
                    reason: {
                        type: 'string',
                        description: 'Optional short note about why (e.g., caller phrase).'
                    }
                },
                required: ['mode']
            },
            description: 'Toggle mic processing based on caller phrases: speakerphone-on → far_field; off-speakerphone → near_field. Debounce and avoid redundant toggles; one tool call per turn.'
        };

        // Define end_call tool
        const endCallTool = {
            type: 'function',
            name: 'end_call',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Optional short phrase indicating why the caller wants to end.' }
                }
            },
            description: 'Politely end the call. The server will close the Twilio media-stream and OpenAI WebSocket after the assistant says a brief goodbye.'
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
                        input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'semantic_vad', eagerness: 'low', interrupt_response: true, create_response: true }, noise_reduction: { type: currentNoiseReductionType } },
                        output: { format: { type: 'audio/pcmu' }, voice: VOICE },
                    },
                    instructions: SYSTEM_MESSAGE,
                    tools: [ gptWebSearchTool, sendEmailTool, updateMicDistanceTool, endCallTool ],
                    tool_choice: 'auto',
                },
            };

            console.log('Sending session update:', stringifyDeep(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
            // After updating session, flush any queued messages (e.g., initial greeting)
            flushPendingOpenAiMessages();

            // Initial greeting will be sent after Twilio 'start' event once caller name is known
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
                    if (SHOW_TIMING_MATH) console.log('Sending truncation event:', stringifyDeep(truncateEvent));
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
                        const callId = functionCall.call_id;
                        if (!callId) {
                            console.warn('Function call missing call_id; skipping to prevent duplicate execution.');
                            return;
                        }
                        
                        
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
                                        if (IS_DEV) console.log('LLM tool output sent to OpenAI', toolResultEvent);
                                        // Tool call completed
                                    })
                                    .catch((error) => {
                                        console.error('Error handling web search tool call:', error);
                                        toolCallInProgress = false;
                                        stopWaitingMusic();
                                        clearWaitingMusicInterval();
                                        // Send error result back to OpenAI (and log)
                                        sendOpenAiToolError(functionCall.call_id, error);
                                        // Tool call errored
                                    });
                            } catch (parseError) {
                                console.error('Error parsing tool arguments:', parseError);
                                toolCallInProgress = false;
                                stopWaitingMusic();
                                clearWaitingMusicInterval();
                                // Tool call parse error
                            }
                        } else if (functionCall.name === 'send_email') {
                            // Schedule waiting music in case email sending takes time
                            toolCallInProgress = true;
                            waitingMusicStartTimeout = setTimeout(() => {
                                if (toolCallInProgress) startWaitingMusic();
                            }, WAIT_MUSIC_THRESHOLD_MS);
                            try {
                                const toolInput = JSON.parse(functionCall.arguments);
                                const subjectRaw = String(toolInput.subject || '').trim();
                                const bodyHtml = String(toolInput.body_html || '').trim();
                                if (IS_DEV) console.log('Dev tool call send_email input:', { subject: subjectRaw, body_html: bodyHtml });

                                if (!subjectRaw || !bodyHtml) {
                                    const errMsg = 'Missing subject or body_html.';
                                    toolCallInProgress = false;
                                    stopWaitingMusic();
                                    clearWaitingMusicInterval();
                                    sendOpenAiToolError(functionCall.call_id, errMsg);
                                    // Cleanup on validation error
                                    
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
                                    toolCallInProgress = false;
                                    stopWaitingMusic();
                                    clearWaitingMusicInterval();
                                    sendOpenAiToolError(functionCall.call_id, errMsg);
                                    // Cleanup when email configuration prevents sending
                                    
                                    return;
                                }

                                // Send email
                                const mailOptions = {
                                    from: fromEmail,
                                    to: toEmail,
                                    subject,
                                    html: bodyHtml,
                                    headers: {
                                        'X-From-Ai-Assistant': 'true'
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
                                    toolCallInProgress = false;
                                    stopWaitingMusic();
                                    clearWaitingMusicInterval();
                                    openAiWs.send(JSON.stringify(toolResultEvent));
                                    openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                    if (IS_DEV) console.log('LLM email tool output sent');
                                    // Email tool call completed
                                }).catch((error) => {
                                    console.error('Email send error:', error);
                                    toolCallInProgress = false;
                                    stopWaitingMusic();
                                    clearWaitingMusicInterval();
                                    sendOpenAiToolError(functionCall.call_id, error);
                                    // Email tool call errored
                                });
                            } catch (parseError) {
                                toolCallInProgress = false;
                                stopWaitingMusic();
                                clearWaitingMusicInterval();
                                sendOpenAiToolError(functionCall.call_id, parseError);
                                // Email tool call parse error
                            }
                        } else if (functionCall.name === 'update_mic_distance') {
                            // Schedule waiting music in case this tool call takes time
                            toolCallInProgress = true;
                            waitingMusicStartTimeout = setTimeout(() => {
                                if (toolCallInProgress) startWaitingMusic();
                            }, WAIT_MUSIC_THRESHOLD_MS);
                            try {
                                const toolInput = JSON.parse(functionCall.arguments);
                                const requestedMode = String(toolInput.mode || '').trim();
                                const reason = typeof toolInput.reason === 'string' ? toolInput.reason.trim() : undefined;
                                if (IS_DEV) console.log('Dev tool call update_mic_distance input:', { requestedMode, reason });

                                const validModes = new Set(['near_field', 'far_field']);
                                if (!validModes.has(requestedMode)) {
                                    const err = `Invalid mode: ${requestedMode}. Expected near_field or far_field.`;
                                    toolCallInProgress = false;
                                    stopWaitingMusic();
                                    clearWaitingMusicInterval();
                                    sendOpenAiToolError(functionCall.call_id, err);
                                    return;
                                }

                                const now = Date.now();
                                const withinDebounce = (now - lastMicDistanceToggleTs) < 2000;
                                const isNoOp = requestedMode === currentNoiseReductionType;

                                if (withinDebounce || isNoOp) {
                                    if (isNoOp) skippedNoOp++;
                                    const output = {
                                        status: 'noop',
                                        applied: false,
                                        reason: withinDebounce ? 'debounced' : 'already-set',
                                        mode: requestedMode,
                                        current: currentNoiseReductionType,
                                        counters: { farToggles, nearToggles, skippedNoOp }
                                    };
                                    const toolResultEvent = {
                                        type: 'conversation.item.create',
                                        item: {
                                            type: 'function_call_output',
                                            call_id: functionCall.call_id,
                                            output: JSON.stringify(output)
                                        }
                                    };
                                    toolCallInProgress = false;
                                    stopWaitingMusic();
                                    clearWaitingMusicInterval();
                                    openAiWs.send(JSON.stringify(toolResultEvent));
                                    openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                    
                                    return;
                                }

                                // Apply session.update with the requested mode
                                const sessionUpdate = {
                                    type: 'session.update',
                                    session: {
                                        audio: {
                                            input: {
                                                noise_reduction: { type: requestedMode }
                                            }
                                        }
                                    }
                                };
                                console.log('Applying noise_reduction change:', sessionUpdate);
                                openAiWs.send(JSON.stringify(sessionUpdate));
                                currentNoiseReductionType = requestedMode;
                                lastMicDistanceToggleTs = now;
                                if (requestedMode === 'far_field') farToggles++; else nearToggles++;

                                const output = {
                                    status: 'ok',
                                    applied: true,
                                    mode: requestedMode,
                                    current: currentNoiseReductionType,
                                    reason,
                                    counters: { farToggles, nearToggles, skippedNoOp }
                                };
                                const toolResultEvent = {
                                    type: 'conversation.item.create',
                                    item: {
                                        type: 'function_call_output',
                                        call_id: functionCall.call_id,
                                        output: JSON.stringify(output)
                                    }
                                };
                                toolCallInProgress = false;
                                stopWaitingMusic();
                                clearWaitingMusicInterval();
                                openAiWs.send(JSON.stringify(toolResultEvent));
                                openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                if (IS_DEV) console.log('Noise reduction updated:', output);
                            } catch (parseError) {
                                console.error('Error parsing update_mic_distance args:', parseError);
                                toolCallInProgress = false;
                                stopWaitingMusic();
                                clearWaitingMusicInterval();
                                sendOpenAiToolError(functionCall.call_id, parseError);
                            }
                        } else if (functionCall.name === 'end_call') {
                            // No waiting music needed; we will end promptly after goodbye.
                            try {
                                const toolInput = JSON.parse(functionCall.arguments || '{}');
                                const reason = typeof toolInput.reason === 'string' ? toolInput.reason.trim() : undefined;
                                pendingDisconnect = true;
                                // Fallback: ensure we close even if marks are missing
                                if (pendingDisconnectTimeout) clearTimeout(pendingDisconnectTimeout);
                                pendingDisconnectTimeout = setTimeout(() => {
                                    // Attempt close; if marks still pending, force close
                                    if (pendingDisconnect) {
                                        pendingDisconnect = false;
                                        stopWaitingMusic();
                                        clearWaitingMusicInterval();
                                        try { connection.close(1000, 'Call ended by assistant (timeout)'); } catch {}
                                        try { if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close(); } catch {}
                                        console.log('Call closed after timeout fallback.');
                                    }
                                }, 4000);

                                const output = {
                                    status: 'ok',
                                    pending_disconnect: true,
                                    reason,
                                };
                                const toolResultEvent = {
                                    type: 'conversation.item.create',
                                    item: {
                                        type: 'function_call_output',
                                        call_id: functionCall.call_id,
                                        output: JSON.stringify(output)
                                    }
                                };
                                openAiWs.send(JSON.stringify(toolResultEvent));
                                openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                if (IS_DEV) console.log('end_call tool acknowledged; awaiting goodbye playback.');
                            } catch (parseError) {
                                console.error('Error parsing end_call args:', parseError);
                                sendOpenAiToolError(functionCall.call_id, parseError);
                            }
                        }
                    } else {
                        // Non-function responses: if we were asked to end the call, close after playback finishes
                        attemptPendingDisconnectClose();
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
                        } catch {
                            console.warn('No custom caller parameter found on start event.');
                            // Fallback greeting without a personalized name
                            sendInitialConversationItem('legend');
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
            if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
            if (pendingDisconnectTimeout) {
                clearTimeout(pendingDisconnectTimeout);
                pendingDisconnectTimeout = null;
            }
            // Clear any queued messages on close
            pendingOpenAiMessages.length = 0;
            stopWaitingMusic();
            clearWaitingMusicInterval();
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
            // Clear queued messages on WS close
            pendingOpenAiMessages.length = 0;
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

        // Fire and forget: send a test email to the PRIMARY user on startup
        // Do not block server readiness
        sendStartupTestEmail().catch(() => {});
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
