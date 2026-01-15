import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import OpenAI from 'openai';

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables.
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
    console.error('Missing OpenAI API key. Please set it in the .env file.');
    process.exit(1);
}

// Initialize OpenAI client
const openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = 'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.';
const VOICE = 'alloy';
const TEMPERATURE = 0.8; // Controls the randomness of the AI's responses
const PORT = process.env.PORT || 5050; // Allow dynamic port assignment

// Waiting music configuration (optional)
const ENABLE_WAIT_MUSIC = process.env.ENABLE_WAIT_MUSIC === 'true';
const WAIT_MUSIC_THRESHOLD_MS = Number(process.env.WAIT_MUSIC_THRESHOLD_MS || 700);
const WAIT_MUSIC_FREQ_HZ = Number(process.env.WAIT_MUSIC_FREQ_HZ || 440);
const WAIT_MUSIC_VOLUME = Number(process.env.WAIT_MUSIC_VOLUME || 0.12); // 0.0 - 1.0

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
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">Please wait while we connect your call to the A. I. voice assistant, powered by Twilio and the Open A I Realtime API</Say>
                              <Pause length="1"/>
                              <Say voice="Google.en-US-Chirp3-HD-Aoede">O.K. you can start talking!</Say>
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
        let sinePhase = 0;

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
            if (!waitingMusicInterval) {
                waitingMusicInterval = setInterval(() => {
                    if (!isWaitingMusic || !streamSid) return;
                    const frameSize = 160; // 20ms @ 8kHz mono
                    const sampleRate = 8000;
                    const freq = WAIT_MUSIC_FREQ_HZ;
                    const volume = WAIT_MUSIC_VOLUME;
                    const bytes = new Uint8Array(frameSize);
                    for (let i = 0; i < frameSize; i++) {
                        const sample = Math.sin(sinePhase) * volume;
                        const pcm = Math.max(-1, Math.min(1, sample));
                        const s16 = Math.floor(pcm * 32767);
                        bytes[i] = linearToMuLaw(s16);
                        sinePhase += (2 * Math.PI * freq) / sampleRate;
                        if (sinePhase > 1e9) sinePhase = sinePhase % (2 * Math.PI);
                    }
                    const payload = Buffer.from(bytes).toString('base64');
                    connection.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
                }, 20);
            }
        }

        function stopWaitingMusic() {
            if (waitingMusicStartTimeout) {
                clearTimeout(waitingMusicStartTimeout);
                waitingMusicStartTimeout = null;
            }
            if (isWaitingMusic) {
                isWaitingMusic = false;
            }
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
                    truncations: 'auto',
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

            // Uncomment the following line to have AI speak first:
            // sendInitialConversationItem();
        };

        // Send initial conversation item if AI talks first
        const sendInitialConversationItem = () => {
            const initialConversationItem = {
                type: 'conversation.item.create',
                item: {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Greet the user with "Hello there! I am an AI voice assistant powered by Twilio and the OpenAI Realtime API. You can ask me for facts, jokes, or anything you can imagine. How can I help you?"'
                        }
                    ]
                }
            };

            if (SHOW_TIMING_MATH) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify(initialConversationItem));
            openAiWs.send(JSON.stringify({ type: 'response.create' }));
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

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});
