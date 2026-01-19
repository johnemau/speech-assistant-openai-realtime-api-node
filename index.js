import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { smsHandler } from './src/routes/sms.js';
import { incomingCallHandler } from './src/routes/incoming-call.js';
import { mediaStreamHandler } from './src/routes/media-stream.js';
import { NGROK_DOMAIN, PORT } from './src/init.js';

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function rootHandler(request, reply) {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function healthzHandler(request, reply) {
    // Respond quickly with a 2xx to indicate instance is healthy
    reply.code(200).send({ status: 'ok' });
}

// Root Route
fastify.get('/', rootHandler);

// Health Check Route (for Render/uptime monitors)
fastify.get('/healthz', healthzHandler);

fastify.post('/sms', smsHandler);

fastify.all('/incoming-call', incomingCallHandler);

// WebSocket route for media-stream
fastify.get('/media-stream', { websocket: true }, mediaStreamHandler);

// Start server and establish ngrok ingress using SessionBuilder
(async () => {
    try {
        fastify.listen({ host: '0.0.0.0', port: PORT });
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
