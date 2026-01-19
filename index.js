import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { registerSmsRoute } from './src/routes/sms.js';
import { registerIncomingCallRoute } from './src/routes/incoming-call.js';
import { registerMediaStreamRoute } from './src/routes/media-stream.js';
import { NGROK_DOMAIN, PORT } from './src/app-context.js';

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

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
    fastify
});

registerIncomingCallRoute({
    fastify
});

// WebSocket route for media-stream
registerMediaStreamRoute({
    fastify
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
