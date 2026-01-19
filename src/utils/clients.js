import OpenAI from 'openai';
import twilio from 'twilio';
import nodemailer from 'nodemailer';

export function createOpenAIClient({ apiKey }) {
    if (!apiKey) {
        throw new Error('Missing OpenAI API key.');
    }
    return new OpenAI({ apiKey });
}

export function createTwilioClient({
    accountSid,
    authToken,
    apiKey,
    apiSecret,
    logger = console
}) {
    try {
        // Prefer API Key + Secret with Account SID (recommended by Twilio for production)
        if (apiKey && apiSecret && accountSid) {
            const client = twilio(apiKey, apiSecret, { accountSid });
            logger.log('Twilio REST client initialized with API Key + Secret.');
            return client;
        }
        if (accountSid && authToken) {
            // Fallback: Account SID + Auth Token (best for local testing)
            const client = twilio(accountSid, authToken);
            logger.log('Twilio REST client initialized with Account SID + Auth Token.');
            return client;
        }
        logger.warn('Twilio credentials missing; provide API Key + Secret + Account SID or Account SID + Auth Token. SMS auto-reply will be unavailable.');
        return null;
    } catch (e) {
        logger.warn('Failed to initialize Twilio REST client:', e?.message || e);
        return null;
    }
}

export function createEmailTransport({ user, pass, serviceId, logger = console }) {
    if (!user || !pass) {
        logger.warn('SMTP credentials missing; send_email will be unavailable.');
        return null;
    }
    const transport = nodemailer.createTransport({
        service: serviceId,
        auth: { user, pass },
    });
    transport.verify().then(() => {
        logger.log('Email transporter verified.');
    }).catch((err) => {
        logger.warn('Email transporter verification failed:', err?.message || err);
    });
    return transport;
}
