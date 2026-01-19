import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { createAssistantSession, safeParseToolArguments } from './src/assistant/session.js';
import { getToolDefinitions, executeToolCall } from './src/tools/index.js';
import { SYSTEM_MESSAGE, WEB_SEARCH_INSTRUCTIONS, SMS_REPLY_INSTRUCTIONS } from './src/assistant/prompts.js';
import { createOpenAIClient, createTwilioClient, createEmailTransport } from './src/utils/clients.js';
import { stringifyDeep } from './src/utils/format.js';
import { normalizeUSNumberToE164 } from './src/utils/phone.js';
import { setupConsoleRedaction, redactErrorDetail } from './src/utils/redaction.js';
import { registerSmsRoute } from './src/routes/sms.js';
import { registerIncomingCallRoute } from './src/routes/incoming-call.js';
import { registerMediaStreamRoute } from './src/routes/media-stream.js';

// Load environment variables from .env file
dotenv.config();

// Environment flags
const IS_DEV = String(process.env.NODE_ENV || '').toLowerCase() === 'development';
// Enable redaction of sensitive env vars from console and stdout
const { secretKeys: REDACTION_KEYS } = setupConsoleRedaction(process.env);

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
const openaiClient = createOpenAIClient({ apiKey: OPENAI_API_KEY });

// Initialize Twilio REST client (for SMS send/list). This is separate from the TwiML helper usage.
const twilioClient = createTwilioClient({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    apiKey: TWILIO_API_KEY,
    apiSecret: TWILIO_API_SECRET,
    logger: console
});

// Initialize Nodemailer transporter (single sender) using service ID
let senderTransport = createEmailTransport({
    user: SMTP_USER,
    pass: SMTP_PASS,
    serviceId: SMTP_NODEMAILER_SERVICE_ID,
    logger: console
});
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
const DEFAULT_SMS_USER_LOCATION = { type: 'approximate', country: 'US', region: 'Washington' };

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

registerSmsRoute({
    fastify,
    deps: {
        twilioClient,
        openaiClient,
        normalizeUSNumberToE164,
        primaryCallersSet: PRIMARY_CALLERS_SET,
        secondaryCallersSet: SECONDARY_CALLERS_SET,
        smsReplyInstructions: SMS_REPLY_INSTRUCTIONS,
        defaultUserLocation: DEFAULT_SMS_USER_LOCATION,
        isDev: IS_DEV,
        env: process.env,
        redactionKeys: REDACTION_KEYS,
        redactErrorDetail,
        stringifyDeep,
    }
});

registerIncomingCallRoute({
    fastify,
    deps: {
        normalizeUSNumberToE164,
        allAllowedCallersSet: ALL_ALLOWED_CALLERS_SET,
        primaryCallersSet: PRIMARY_CALLERS_SET,
        secondaryCallersSet: SECONDARY_CALLERS_SET,
        primaryUserFirstName: PRIMARY_USER_FIRST_NAME,
        secondaryUserFirstName: SECONDARY_USER_FIRST_NAME,
    }
});

// WebSocket route for media-stream
registerMediaStreamRoute({
    fastify,
    deps: {
        openaiClient,
        twilioClient,
        senderTransport,
        env: process.env,
        normalizeUSNumberToE164,
        primaryCallersSet: PRIMARY_CALLERS_SET,
        secondaryCallersSet: SECONDARY_CALLERS_SET,
        systemMessage: SYSTEM_MESSAGE,
        webSearchInstructions: WEB_SEARCH_INSTRUCTIONS,
        voice: VOICE,
        temperature: TEMPERATURE,
        waitMusicThresholdMs: WAIT_MUSIC_THRESHOLD_MS,
        waitMusicVolume: WAIT_MUSIC_VOLUME,
        waitMusicFile: WAIT_MUSIC_FILE,
        isDev: IS_DEV,
        showTimingMath: SHOW_TIMING_MATH,
        createAssistantSession,
        safeParseToolArguments,
        getToolDefinitions,
        executeToolCall,
        stringifyDeep,
        defaultUserLocation: DEFAULT_SMS_USER_LOCATION,
    }
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
