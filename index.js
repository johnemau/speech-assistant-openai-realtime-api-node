import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { createOpenAIClient, createTwilioClient, createEmailTransport } from './src/utils/clients.js';
import { setupConsoleRedaction } from './src/utils/redaction.js';
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
const { OPENAI_API_KEY, NGROK_DOMAIN } = process.env;
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
        isDev: IS_DEV,
        env: process.env,
        redactionKeys: REDACTION_KEYS,
    }
});

registerIncomingCallRoute({
    fastify,
    deps: {
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
        voice: VOICE,
        temperature: TEMPERATURE,
        isDev: IS_DEV,
        showTimingMath: SHOW_TIMING_MATH,
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
