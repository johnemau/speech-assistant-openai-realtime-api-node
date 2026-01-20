import OpenAI from 'openai';
import twilio from 'twilio';
import nodemailer from 'nodemailer';

/**
 * Create an OpenAI API client.
 *
 * @param {object} root0 - Client options.
 * @param {string} root0.apiKey - OpenAI API key.
 * @returns {OpenAI} OpenAI client instance.
 */
export function createOpenAIClient({ apiKey }) {
    if (!apiKey) {
        throw new Error('Missing OpenAI API key.');
    }
    return new OpenAI({ apiKey });
}

/**
 * Create a Twilio REST client if credentials are available.
 *
 * @param {object} root0 - Client options.
 * @param {string} [root0.accountSid] - Twilio Account SID.
 * @param {string} [root0.authToken] - Twilio Auth Token.
 * @param {string} [root0.apiKey] - Twilio API Key SID.
 * @param {string} [root0.apiSecret] - Twilio API Key Secret.
 * @returns {import('twilio').Twilio | null} Twilio client or null when unavailable.
 */
export function createTwilioClient({
    accountSid,
    authToken,
    apiKey,
    apiSecret,
}) {
    try {
        // Prefer API Key + Secret with Account SID (recommended by Twilio for production)
        if (apiKey && apiSecret && accountSid) {
            const client = twilio(apiKey, apiSecret, { accountSid });
            console.log(
                'Twilio REST client initialized with API Key + Secret.'
            );
            return client;
        }
        if (accountSid && authToken) {
            // Fallback: Account SID + Auth Token (best for local testing)
            const client = twilio(accountSid, authToken);
            console.log(
                'Twilio REST client initialized with Account SID + Auth Token.'
            );
            return client;
        }
        console.warn(
            'Twilio credentials missing; provide API Key + Secret + Account SID or Account SID + Auth Token. SMS auto-reply will be unavailable.'
        );
        return null;
    } catch (e) {
        console.warn(
            'Failed to initialize Twilio REST client:',
            e?.message || e
        );
        return null;
    }
}

/**
 * Create an SMTP transport for sending email.
 *
 * @param {object} root0 - Transport options.
 * @param {string} [root0.user] - SMTP username.
 * @param {string} [root0.pass] - SMTP password.
 * @param {string} [root0.serviceId] - Nodemailer service id.
 * @returns {import('nodemailer').Transporter | null} Email transport or null.
 */
export function createEmailTransport({ user, pass, serviceId }) {
    if (!user || !pass) {
        console.warn(
            'SMTP credentials missing; send_email will be unavailable.'
        );
        return null;
    }
    const transport = nodemailer.createTransport({
        service: serviceId,
        auth: { user, pass },
    });
    transport
        .verify()
        .then(() => {
            console.log('Email transporter verified.');
        })
        .catch((err) => {
            console.warn(
                'Email transporter verification failed:',
                err?.message || err
            );
        });
    return transport;
}
