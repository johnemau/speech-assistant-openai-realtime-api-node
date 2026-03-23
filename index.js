import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { smsHandler } from './src/routes/sms.js';
import { incomingCallHandler } from './src/routes/incoming-call.js';
import { mediaStreamHandler } from './src/routes/media-stream.js';
import { createMarkdownDocHandler } from './src/routes/markdown-doc.js';
import { emailPageHandler } from './src/routes/email-page.js';
import { pageRepeatHandler } from './src/routes/page-repeat.js';
import { NGROK_DOMAIN, PORT } from './src/init.js';
import {
    SERVICE_OPERATOR_EMAIL,
    ENROLLMENT_FORM_URL,
    ENROLLMENT_FORM_IMAGE_URL,
} from './src/env.js';

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

/**
 * @param {import('fastify').FastifyRequest} _request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
async function rootHandler(_request, reply) {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
}

/**
 * @param {import('fastify').FastifyRequest} _request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
async function healthzHandler(_request, reply) {
    // Respond quickly with a 2xx to indicate instance is healthy
    reply.code(200).send({ status: 'ok' });
}

// Root Route
fastify.get('/', rootHandler);

// Health Check Route (for Render/uptime monitors)
fastify.get('/healthz', healthzHandler);

fastify.post('/sms', smsHandler);

fastify.get(
    '/tos',
    createMarkdownDocHandler({
        filePath: process.env.TERMS_AND_CONDITIONS_FILE_PATH || 'tos.md',
        title: 'Terms of Service',
    })
);

fastify.get(
    '/privacy-policy',
    createMarkdownDocHandler({
        filePath: process.env.PRIVACY_POLICY_FILE_PATH || 'privacy-policy.md',
        title: 'Privacy Policy',
        variables: { SERVICE_OPERATOR_EMAIL },
    })
);

fastify.get(
    '/how-to-opt-in',
    createMarkdownDocHandler({
        filePath: process.env.HOW_TO_OPT_IN_FILE_PATH || 'how-to-opt-in.md',
        title: 'How to Opt In',
        variables: {
            SERVICE_OPERATOR_EMAIL,
            ENROLLMENT_FORM_URL,
            ENROLLMENT_FORM_IMAGE_URL,
        },
    })
);

fastify.post('/email-page', emailPageHandler);

fastify.post('/page-repeat', pageRepeatHandler);

fastify.all('/incoming-call', incomingCallHandler);

// For some reason registering is required for websocket route.
fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, mediaStreamHandler);
});

// Start server and establish ngrok ingress using SessionBuilder
(async () => {
    try {
        fastify.listen({ host: '0.0.0.0', port: PORT });
        console.log(`server: listening on 0.0.0.0:${PORT}`);

        // Optionally establish ngrok ingress if NGROK_DOMAIN is provided
        if (NGROK_DOMAIN) {
            if (!process.env.NGROK_AUTHTOKEN) {
                console.warn(
                    'server: NGROK_AUTHTOKEN is not set, ensure ngrok is authenticated for domain binding'
                );
            }
            const session = await new ngrok.SessionBuilder()
                .authtokenFromEnv()
                .connect();
            const endpointBuilder = session.httpEndpoint().domain(NGROK_DOMAIN);
            console.log(
                `server: ngrok forwarding active on domain ${NGROK_DOMAIN}`
            );
            const listener = await endpointBuilder.listen();
            await listener.forward(`0.0.0.0:${PORT}`);
        } else {
            console.log(
                'server: ngrok domain not configured, skipping ngrok setup'
            );
        }
    } catch (err) {
        console.error('server: startup failed', err);
        process.exit(1);
    }
})();
