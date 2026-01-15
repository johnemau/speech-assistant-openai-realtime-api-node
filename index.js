import ngrok from '@ngrok/ngrok';
import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import OpenAI from 'openai';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();

// Retrieve required environment variables.
const { OPENAI_API_KEY, NGROK_DOMAIN, PRIMARY_USER_FIRST_NAME, SECONDARY_USER_FIRST_NAME, USER_FIRST_NAME } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

if (!NGROK_DOMAIN) {
    console.error('Missing NGROK_DOMAIN. Please set it in the environment or .env file.');
    process.exit(1);
}

// Initialize OpenAI client
const openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = `You are a voice-only assistant on a phone call using the OpenAI Realtime API. Always answer questions about people, places, organizations, events, dates, numbers, current affairs, or other factual topics using information provided by the web search tool. Do not answer from memory. First call the tool named "GPT-web-search" with a concise "query" that captures the user's request (include "user_location" when the user's location is relevant or specified). After making the tool call, wait for a "function_call_output" item before speaking. Base your answer solely on the web search results; keep responses concise and conversational for audio (2–4 sentences) and favor up-to-date facts. If results are empty or inconclusive, say you couldn't find reliable information and ask a brief clarifying question. For non-factual chit-chat (greetings, small talk, jokes), you may respond naturally without calling the tool.

# Tools
- Before any tool call, say one short line like "By your command." Then call the tool immediately.

# Instructions/Rules
...

## Unclear audio 
- Always respond in the same language the user is speaking in, if unintelligible.
- Only respond to clear audio or text. 
- If the user's audio is not clear (e.g. ambiguous input/background noise/silent/unintelligible) or if you did not fully hear or understand the user, ask for clarification using {preferred_language} phrases.

# Instructions/Rules
- When reading numbers or codes, speak each character separately, separated by hyphens (e.g., 4-1-5). 
- Repeat EXACTLY the provided number, do not forget any.`;
const VOICE = 'cedar';
const TEMPERATURE = 0.8; // Controls the randomness of the AI's responses
const PORT = process.env.PORT || 8080; // Allow dynamic port assignment

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
const ENABLE_WAIT_MUSIC = process.env.ENABLE_WAIT_MUSIC === 'true';
const WAIT_MUSIC_THRESHOLD_MS = Number(process.env.WAIT_MUSIC_THRESHOLD_MS || 700);
const WAIT_MUSIC_VOLUME = Number(process.env.WAIT_MUSIC_VOLUME || 0.12); // 0.0 - 1.0
const WAIT_MUSIC_FILE = process.env.WAIT_MUSIC_FILE || null; // e.g., assets/wait-music.mp3

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
const SHOW_TIMING_MATH = false;

// Root Route
fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Twilio Media Stream Server is running!' });
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
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">Sorry, this line is restricted. Goodbye.</Say>
                              <Hangup/>
                          </Response>`;
        return reply.type('text/xml').send(denyTwiml);
    }

    // Choose greeting based on caller list membership
    const primaryName = (PRIMARY_USER_FIRST_NAME || USER_FIRST_NAME || '').trim();
    const secondaryName = (SECONDARY_USER_FIRST_NAME || '').trim();
    let callerName = 'legend';
    if (PRIMARY_CALLERS_SET.has(fromE164) && primaryName) {
        callerName = primaryName;
    } else if (SECONDARY_CALLERS_SET.has(fromE164) && secondaryName) {
        callerName = secondaryName;
    }
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">Hey ${callerName}, connecting to your AI assistant now.</Say>
                              <Pause length="1"/>
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">At your service, ${callerName}. How may I help?</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
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
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        // Waiting music state
        let isWaitingMusic = false;
        let waitingMusicInterval = null;
        let waitingMusicStartTimeout = null;
        let toolCallInProgress = false;
        // ffmpeg removed; we only support WAV files and tone fallback
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
            if (!ENABLE_WAIT_MUSIC || !streamSid || isWaitingMusic) return;
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
                        // Non-WAV files are not supported without ffmpeg; will fall back to tone
                    }
                } catch (e) {
                    console.error('Failed to load waiting music file, falling back to tone:', e);
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
        }

        function clearWaitingMusicInterval() {
            if (waitingMusicInterval) {
                clearInterval(waitingMusicInterval);
                waitingMusicInterval = null;
            }
        }

        const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=${TEMPERATURE}`, {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            }
        });

        // Define the GPT-web-search tool
        const gptWebSearchTool = {
            type: 'function',
            name: 'GPT-web-search',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: "The user's question or topic to research across the live web."
                    },
                    user_location: {
                        type: 'object',
                        description: 'Optional approximate user location to improve local relevance. Defaults to US Washington if not provided.',
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

        // Handle GPT-web-search tool calls
        const handleWebSearchToolCall = async (query, userLocation) => {
            try {
                const result = await openaiClient.responses.create({
                    model: 'gpt-5',
                    reasoning: { effort: 'high' },
                    tools: [{ 
                        type: 'web_search',
                        user_location: userLocation ?? {
                            type: "approximate",
                            country: "US",
                            region: "Washington"
                        },
                     }],
                    input: query,
                    truncation: 'auto',
                });

                console.log('Web search result:', result.output_text);
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
                    model: "gpt-realtime",
                    output_modalities: ["audio"],
                    audio: {
                        input: { format: { type: 'audio/pcmu' }, turn_detection: { type: "server_vad" } },
                        output: { format: { type: 'audio/pcmu' }, voice: VOICE },
                    },
                    instructions: SYSTEM_MESSAGE,
                    tools: [ gptWebSearchTool ],
                },
            };

            console.log('Sending session update:', JSON.stringify(sessionUpdate));
            openAiWs.send(JSON.stringify(sessionUpdate));
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
                    if (SHOW_TIMING_MATH) console.log('Sending truncation event:', JSON.stringify(truncateEvent));
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
                    console.log(`Received event: ${response.type}`, response);
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
                    
                    if (functionCall?.type === 'function_call') {
                        console.log('Function call detected:', functionCall.name);
                        
                        if (functionCall.name === 'GPT-web-search') {
                            // Schedule waiting music if the tool call takes longer than threshold
                            toolCallInProgress = true;
                            if (ENABLE_WAIT_MUSIC) {
                                waitingMusicStartTimeout = setTimeout(() => {
                                    if (toolCallInProgress) startWaitingMusic();
                                }, WAIT_MUSIC_THRESHOLD_MS);
                            }
                            try {
                                const toolInput = JSON.parse(functionCall.arguments);
                                const query = toolInput.query;
                                const userLocation = toolInput.user_location;
                                
                                console.log(`Executing web search for query: ${query}`);
                                handleWebSearchToolCall(query, userLocation)
                                    .then((searchResult) => {
                                        // Tool completed; stop waiting music before continuing response
                                        toolCallInProgress = false;
                                        stopWaitingMusic();
                                        clearWaitingMusicInterval();
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
                                    })
                                    .catch((error) => {
                                        console.error('Error handling web search tool call:', error);
                                        toolCallInProgress = false;
                                        stopWaitingMusic();
                                        clearWaitingMusicInterval();
                                        // Send error result back to OpenAI
                                        const toolErrorEvent = {
                                            type: 'conversation.item.create',
                                            item: {
                                                type: 'function_call_output',
                                                call_id: functionCall.call_id,
                                                output: JSON.stringify({ error: error.message })
                                            }
                                        };
                                        openAiWs.send(JSON.stringify(toolErrorEvent));
                                        openAiWs.send(JSON.stringify({ type: 'response.create' }));
                                    });
                            } catch (parseError) {
                                console.error('Error parsing tool arguments:', parseError);
                                toolCallInProgress = false;
                                stopWaitingMusic();
                                clearWaitingMusicInterval();
                            }
                        }
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
                        break;
                    case 'mark':
                        if (markQueue.length > 0) {
                            markQueue.shift();
                        }
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
            stopWaitingMusic();
            clearWaitingMusicInterval();
            console.log('Client disconnected.');
        });

        // Handle WebSocket close and errors
        openAiWs.on('close', () => {
            console.log('Disconnected from the OpenAI Realtime API');
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
        await fastify.listen({ port: PORT });

        const session = await new ngrok.SessionBuilder().authtokenFromEnv().connect();
        const endpointBuilder = session.httpEndpoint().domain(NGROK_DOMAIN);
        const listener = await endpointBuilder.listen();
        await listener.forward(`localhost:${PORT}`);

        console.log(`Server is listening on port ${PORT}`);
        console.log(`Ingress established at: ${listener.url()}`);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
