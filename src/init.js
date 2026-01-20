import {
    createOpenAIClient,
    createTwilioClient,
    createEmailTransport,
} from './utils/clients.js';
import { setupConsoleRedaction } from './utils/redaction.js';
import { IS_DEV } from './env.js';
import { REALTIME_TEMPERATURE } from './config/openai-models.js';

// Enable redaction of sensitive env vars from console and stdout
setupConsoleRedaction(process.env);

// Retrieve required environment variables.
const { OPENAI_API_KEY, NGROK_DOMAIN } = process.env;
const {
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_API_KEY,
    TWILIO_API_SECRET,
} = process.env;

// Email-related environment variables
const { SENDER_FROM_EMAIL, SMTP_USER, SMTP_PASS, SMTP_NODEMAILER_SERVICE_ID } =
    process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

// Initialize OpenAI client
export let openaiClient = createOpenAIClient({ apiKey: OPENAI_API_KEY });

// Initialize Twilio REST client (for SMS send/list). This is separate from the TwiML helper usage.
export let twilioClient = createTwilioClient({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    apiKey: TWILIO_API_KEY,
    apiSecret: TWILIO_API_SECRET,
    logger: console,
});

// Initialize Nodemailer transporter (single sender) using service ID
export let senderTransport = createEmailTransport({
    user: SMTP_USER,
    pass: SMTP_PASS,
    serviceId: SMTP_NODEMAILER_SERVICE_ID,
    logger: console,
});
if (!SENDER_FROM_EMAIL) {
    console.warn(
        'SENDER_FROM_EMAIL missing; emails cannot be sent until configured.'
    );
}

export const env = process.env;
export const VOICE = 'cedar';
export const TEMPERATURE = REALTIME_TEMPERATURE; // Controls the randomness of the AI's responses
export const SHOW_TIMING_MATH = IS_DEV;
export const PORT = Number(process.env.PORT || 10000); // Render default PORT is 10000
export { NGROK_DOMAIN };

/**
 * Test-only override for init clients.
 * @param {{ openaiClient?: any, twilioClient?: any, senderTransport?: any }} overrides - Overrides to apply.
 */
export function setInitClients({
    openaiClient: nextOpenAI,
    twilioClient: nextTwilio,
    senderTransport: nextSender,
} = {}) {
    if (nextOpenAI !== undefined) openaiClient = nextOpenAI;
    if (nextTwilio !== undefined) twilioClient = nextTwilio;
    if (nextSender !== undefined) senderTransport = nextSender;
}
