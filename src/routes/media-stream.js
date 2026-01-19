import WebSocket from 'ws';
import fs from 'fs';
import { SYSTEM_MESSAGE, WEB_SEARCH_INSTRUCTIONS } from '../assistant/prompts.js';
import { createAssistantSession, safeParseToolArguments } from '../assistant/session.js';
import {
    openaiClient,
    twilioClient,
    senderTransport,
    env,
    VOICE as voice,
    TEMPERATURE as temperature,
    SHOW_TIMING_MATH as showTimingMath,
} from '../init.js';
import { parseWavToUlaw } from '../utils/audio.js';
import { getToolDefinitions, executeToolCall } from '../tools/index.js';
import { stringifyDeep } from '../utils/format.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import {
    DEFAULT_SMS_USER_LOCATION,
    IS_DEV,
    PRIMARY_CALLERS_SET,
    SECONDARY_CALLERS_SET,
    WAIT_MUSIC_FILE,
    WAIT_MUSIC_THRESHOLD_MS,
    WAIT_MUSIC_VOLUME,
    PRIMARY_USER_FIRST_NAME,
    SECONDARY_USER_FIRST_NAME,
} from '../env.js';

/**
 * @param {import('@fastify/websocket').SocketStream} connection
 * @param {import('fastify').FastifyRequest} req
 * @returns {void}
 */
export function mediaStreamHandler(connection, req) {
        console.log('Client connected');

        // Connection-specific state
        let streamSid = null;
        let currentCallerE164 = null;
        let currentTwilioNumberE164 = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;
        let pendingDisconnect = false;
        let pendingDisconnectTimeout = null;

        // Track response lifecycle to avoid overlapping response.create calls
        let responseActive = false;

        // Post-hang-up behavior: suppress audio, continue tools, then SMS
        let postHangupSilentMode = false; // when true, do not send any audio back to Twilio
        let postHangupSmsSent = false;    // ensure the completion SMS is sent at most once
        let lastWebSearchQuery = null;    // capture recent query to summarize
        let lastEmailSubject = null;      // capture subject to summarize
        let hangupDuringTools = false;    // true if caller hung up while tools were pending/active

        // Mic distance / noise reduction state & counters
        const micState = {
            currentNoiseReductionType: 'near_field',
            lastMicDistanceToggleTs: 0,
            farToggles: 0,
            nearToggles: 0,
            skippedNoOp: 0,
        };

        // Waiting music state
        let isWaitingMusic = false;
        let waitingMusicInterval = null;
        let waitingMusicStartTimeout = null;
        let toolCallInProgress = false;
        // Track the very first assistant audio to stop initial wait music
        let firstAssistantAudioReceived = false;
        // ffmpeg removed; we only support WAV files; no tone fallback
        let waitingMusicUlawBuffer = null;
        let waitingMusicOffset = 0;

        function startWaitingMusic(reason = 'unknown') {
            if (!streamSid || isWaitingMusic) return;
            isWaitingMusic = true;
            try {
                console.info({
                    event: 'wait_music.start',
                    reason,
                    streamSid,
                    threshold_ms: WAIT_MUSIC_THRESHOLD_MS,
                    file: WAIT_MUSIC_FILE || null
                });
            } catch {}
            // If audio file is provided and exists
            if (WAIT_MUSIC_FILE && fs.existsSync(WAIT_MUSIC_FILE)) {
                try {
                    if (WAIT_MUSIC_FILE.toLowerCase().endsWith('.wav')) {
                        // Parse WAV and pre-encode to µ-law buffer
                        waitingMusicUlawBuffer = parseWavToUlaw(WAIT_MUSIC_FILE, WAIT_MUSIC_VOLUME);
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
                        // Non-WAV files are not supported without ffmpeg; waiting music disabled
                        console.warn({ event: 'wait_music.unsupported_file', file: WAIT_MUSIC_FILE });
                    }
                } catch (e) {
                    console.error('Failed to load waiting music file; disabling waiting music:', e?.message || e);
                }
            }

            // No fallback tone; only WAV file is supported for waiting music.
        }

        function stopWaitingMusic(reason = 'unknown') {
            if (waitingMusicStartTimeout) {
                clearTimeout(waitingMusicStartTimeout);
                waitingMusicStartTimeout = null;
            }
            if (isWaitingMusic) {
                isWaitingMusic = false;
                try {
                    console.info({ event: 'wait_music.stop', reason, streamSid });
                } catch {}
            }
            // Remove unused buffer since ffmpeg is not used
            waitingMusicUlawBuffer = null;
            waitingMusicOffset = 0;
            // Ensure any playback interval is cleared
            clearWaitingMusicInterval();
        }

        function clearWaitingMusicInterval() {
            if (waitingMusicInterval) {
                clearInterval(waitingMusicInterval);
                waitingMusicInterval = null;
            }
        }

        function attemptPendingDisconnectClose() {
            try {
                if (!pendingDisconnect) return;
                // Prefer closing after Twilio marks catch up (no queued marks)
                if (markQueue.length === 0) {
                    pendingDisconnect = false;
                    if (pendingDisconnectTimeout) {
                        clearTimeout(pendingDisconnectTimeout);
                        pendingDisconnectTimeout = null;
                    }
                    stopWaitingMusic();
                    clearWaitingMusicInterval();
                    try { connection.close(1000, 'Call ended by assistant'); } catch {}
                    try { if (assistantSession.openAiWs?.readyState === WebSocket.OPEN) assistantSession.close(); } catch {}
                    console.log('Call closed after goodbye playback.');
                }
            } catch (e) {
                console.warn('Attempt to close pending disconnect failed:', e?.message || e);
            }
        }

        const handleAssistantOutput = (payload) => {
            if (payload?.type !== 'audio' || !payload?.delta) return;
            // Suppress audio entirely after hang-up; otherwise, stream to Twilio
            // Mark that the assistant has started speaking (first-time check)
            if (!firstAssistantAudioReceived) firstAssistantAudioReceived = true;
            // Assistant audio is streaming; stop any waiting music immediately
            stopWaitingMusic('assistant_audio');
            if (!postHangupSilentMode) {
                const audioDelta = {
                    event: 'media',
                    streamSid: streamSid,
                    media: { payload: payload.delta }
                };
                connection.send(JSON.stringify(audioDelta));

                // First delta from a new response starts the elapsed time counter
                if (!responseStartTimestampTwilio) {
                    responseStartTimestampTwilio = latestMediaTimestamp;
                    if (showTimingMath) console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
                }

                if (payload.itemId) {
                    lastAssistantItem = payload.itemId;
                }
                
                sendMark(connection, streamSid);
            }
        };

        const handleOpenAiEvent = (response) => {
            if (LOG_EVENT_TYPES.includes(response.type)) {
                if (IS_DEV) console.log(`Received event: ${response.type}`, response);
                else console.log(`Received event: ${response.type}`);
            }

                // Track response lifecycle to avoid overlapping creates
                if (response.type === 'response.created') {
                    responseActive = true;
                }
            if (response.type === 'response.done') {
                responseActive = false;
            }

                // When VAD ends a user turn, we must explicitly create a response (auto-create disabled)
            if (response.type === 'input_audio_buffer.speech_stopped') {
                stopWaitingMusic('speech_stopped');
                if (!responseActive) {
                    try {
                        assistantSession.requestResponse();
                    } catch (e) {
                        console.warn('Failed to request response.create after speech_stopped:', e?.message || e);
                    }
                }
            }

            if (response.type === 'input_audio_buffer.speech_started') {
                // Caller barged in; stop waiting music and handle truncation
                stopWaitingMusic('caller_speech');
                handleSpeechStartedEvent();
            }

            if (response.type === 'response.done') {
                const functionCall = response.response?.output?.[0];
                if (!functionCall || functionCall?.type !== 'function_call') {
                    // Non-function responses: if we were asked to end the call, close after playback finishes
                    attemptPendingDisconnectClose();
                    // If in silent mode and no tool call is active, send a completion SMS and close OpenAI WS
                    if (postHangupSilentMode && hangupDuringTools && !toolCallInProgress && !postHangupSmsSent) {
                        try {
                            const toNumber = currentCallerE164;
                            const envFrom = normalizeUSNumberToE164(env?.TWILIO_SMS_FROM_NUMBER || '');
                            const fromNumber = currentTwilioNumberE164 || envFrom;
                            if (twilioClient && toNumber && fromNumber) {
                                const subjectNote = lastEmailSubject ? ` Email sent: "${lastEmailSubject}".` : '';
                                const body = `Your request is complete.${subjectNote} Reply if you want more.`;
                                if (IS_DEV) console.log('Post-hang-up completion SMS:', { from: fromNumber, to: toNumber, body });
                                twilioClient.messages.create({ from: fromNumber, to: toNumber, body })
                                    .then((sendRes) => {
                                        console.info({ event: 'posthangup.sms.sent', sid: sendRes?.sid, to: toNumber });
                                    })
                                    .catch((e) => {
                                        console.warn('Post-hang-up SMS send error:', e?.message || e);
                                    });
                                postHangupSmsSent = true;
                            } else {
                                console.warn({ event: 'posthangup.sms.unavailable', to: toNumber, from: fromNumber });
                            }
                        } catch (e) {
                            console.warn('Post-hang-up SMS error:', e?.message || e);
                        }
                        // Close OpenAI WS after completion notification
                        try { if (assistantSession.openAiWs?.readyState === WebSocket.OPEN) assistantSession.close(); } catch {}
                    }
                }
            }
        };

        const handleToolCall = async (functionCall) => {
                if (IS_DEV) console.log('LLM response.done received');
                console.log('Function call detected:', functionCall.name);
                const callId = functionCall.call_id;
                if (!callId) {
                    console.warn('Function call missing call_id; skipping to prevent duplicate execution.');
                    return;
                }

                const toolName = functionCall.name;
                const shouldUseWaitingMusic = toolName !== 'end_call';
                if (shouldUseWaitingMusic) {
                    toolCallInProgress = true;
                    waitingMusicStartTimeout = setTimeout(() => {
                        if (toolCallInProgress) startWaitingMusic();
                    }, WAIT_MUSIC_THRESHOLD_MS);
                } else {
                    toolCallInProgress = true;
                }

                try {
                    const toolInput = safeParseToolArguments(functionCall.arguments);
                    if (postHangupSilentMode) hangupDuringTools = true;
                    if (toolName === 'gpt_web_search') {
                        lastWebSearchQuery = toolInput?.query || lastWebSearchQuery;
                    }
                    if (toolName === 'send_email') {
                        const subjectRaw = String(toolInput?.subject || '').trim();
                        if (subjectRaw) lastEmailSubject = subjectRaw;
                    }

                    const toolContext = {
                        openaiClient,
                        twilioClient,
                        senderTransport,
                        env,
                        normalizeUSNumberToE164,
                        primaryCallersSet: PRIMARY_CALLERS_SET,
                        secondaryCallersSet: SECONDARY_CALLERS_SET,
                        currentCallerE164,
                        currentTwilioNumberE164,
                        webSearchInstructions: WEB_SEARCH_INSTRUCTIONS,
                        defaultUserLocation: DEFAULT_SMS_USER_LOCATION,
                        allowLiveSideEffects: true,
                        micState,
                        applyNoiseReduction: (mode) => {
                            const sessionUpdate = {
                                audio: {
                                    input: {
                                        noise_reduction: { type: mode }
                                    }
                                }
                            };
                            if (IS_DEV) console.log('Applying noise_reduction change:', sessionUpdate);
                            assistantSession.updateSession(sessionUpdate);
                        },
                        onEndCall: ({ reason }) => {
                            // Enter silent mode: do not send any audio; allow tools to finish
                            postHangupSilentMode = true;
                            pendingDisconnect = true;
                            if (toolCallInProgress) hangupDuringTools = true;
                            // Close the Twilio stream promptly; keep OpenAI WS alive for tools
                            try { connection.close(1000, 'Call ended by assistant'); } catch {}
                            return {
                                status: 'ok',
                                pending_disconnect: true,
                                reason,
                                silent: true
                            };
                        }
                    };

                    const output = await executeToolCall({ name: toolName, args: toolInput, context: toolContext });

                    if (toolName === 'update_mic_distance') {
                        if (IS_DEV) console.log('Noise reduction updated:', output);
                    }

                    if (toolName === 'gpt_web_search' && IS_DEV) {
                        console.log('Dev tool call gpt_web_search output:', output);
                    }

                    const toolResultEvent = {
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: functionCall.call_id,
                            output: JSON.stringify(output)
                        }
                    };
                    toolCallInProgress = false;
                    stopWaitingMusic('tool_call_complete');
                    clearWaitingMusicInterval();
                    assistantSession.send(toolResultEvent);
                    if (!responseActive) assistantSession.requestResponse();
                    if (IS_DEV) console.log('LLM tool output sent to OpenAI', toolResultEvent);
                } catch (error) {
                    console.error('Error handling tool call:', error);
                    toolCallInProgress = false;
                    stopWaitingMusic('tool_error');
                    clearWaitingMusicInterval();
                    sendOpenAiToolError(functionCall.call_id, error);
                }
            };

        const assistantSession = createAssistantSession({
                apiKey: env?.OPENAI_API_KEY,
                model: 'gpt-realtime',
                temperature,
                voice,
                instructions: SYSTEM_MESSAGE,
                tools: getToolDefinitions(),
                outputModalities: ['audio'],
                audioConfig: {
                    input: {
                        format: { type: 'audio/pcmu' },
                        turn_detection: { type: 'semantic_vad', eagerness: 'low', interrupt_response: true, create_response: false },
                        noise_reduction: { type: micState.currentNoiseReductionType }
                    },
                    output: { format: { type: 'audio/pcmu' }, voice },
                },
                onEvent: handleOpenAiEvent,
                onAssistantOutput: handleAssistantOutput,
                onToolCall: handleToolCall,
                onOpen: () => console.log('Connected to the OpenAI Realtime API'),
                onClose: () => {
                    console.log('Disconnected from the OpenAI Realtime API');
                    stopWaitingMusic();
                    clearWaitingMusicInterval();
                },
                onError: (error) => {
                    console.error('Error in the OpenAI WebSocket:', error);
                    stopWaitingMusic();
                    clearWaitingMusicInterval();
                }
            });

            // Send initial conversation item using the caller's name once available
        const sendInitialConversationItem = (callerNameValue = 'legend') => {
                const initialConversationItem = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: `Greet the caller in English with a single, concise, butler/service‑worker style line that politely addresses them as "${callerNameValue}" and is similar to "At your service ${callerNameValue}, how may I help?". Keep it light and optionally witty; always include the name.`
                            }
                        ]
                    }
                };

                if (showTimingMath) console.log('Sending initial conversation item:', JSON.stringify(initialConversationItem));
                assistantSession.send(initialConversationItem);
                assistantSession.requestResponse();
            };

            // Helper to log and send tool errors to OpenAI WS
        function sendOpenAiToolError(callId, errorLike) {
                const msg = (typeof errorLike === 'string') ? errorLike : (errorLike?.message || String(errorLike));
                try {
                    console.error('Sending tool error to OpenAI WS:', msg);
                    const toolErrorEvent = {
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: callId,
                            output: JSON.stringify({ error: msg })
                        }
                    };
                    assistantSession.send(toolErrorEvent);
                    if (!responseActive) assistantSession.requestResponse();
                } catch (e) {
                    console.error('Failed to send tool error to OpenAI WS:', e);
                }
            }

            // Handle interruption when the caller's speech starts
        const handleSpeechStartedEvent = () => {
                if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                    const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
                    if (showTimingMath) console.log(`Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);

                    if (lastAssistantItem) {
                        const truncateEvent = {
                            type: 'conversation.item.truncate',
                            item_id: lastAssistantItem,
                            content_index: 0,
                            audio_end_ms: elapsedTime
                        };
                        if (showTimingMath) console.log('Sending truncation event:', stringifyDeep(truncateEvent));
                        assistantSession.send(truncateEvent);
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

            // Handle incoming messages from Twilio
        connection.on('message', (message) => {
                try {
                    const data = JSON.parse(message);

                    switch (data.event) {
                        case 'media':
                            latestMediaTimestamp = data.media.timestamp;
                            const audioAppend = {
                                type: 'input_audio_buffer.append',
                                audio: data.media.payload
                            };
                            assistantSession.send(audioAppend);
                            break;
                        case 'start':
                            streamSid = data.start.streamSid;
                            console.log('Incoming stream has started', streamSid);

                            // Reset start and media timestamp on a new stream
                            responseStartTimestampTwilio = null; 
                            latestMediaTimestamp = 0;
                            // Ensure waiting music is not running for a new stream
                            stopWaitingMusic('new_stream');
                            clearWaitingMusicInterval();

                            // Read caller number from custom parameters passed via TwiML Parameter
                            try {
                                const cp = data.start?.customParameters || data.start?.custom_parameters || {};
                                const rawCaller = cp.caller_number || cp.callerNumber || null;
                                currentCallerE164 = normalizeUSNumberToE164(rawCaller);
                                if (currentCallerE164) console.log('Caller (from TwiML Parameter):', rawCaller, '=>', currentCallerE164);
                                const rawTwilioNum = cp.twilio_number || cp.twilioNumber || null;
                                currentTwilioNumberE164 = normalizeUSNumberToE164(rawTwilioNum);
                                if (currentTwilioNumberE164) console.log('Twilio number (from TwiML Parameter):', rawTwilioNum, '=>', currentTwilioNumberE164);
                                // Compute caller name based on group and send initial greeting
                                const primaryName = String(PRIMARY_USER_FIRST_NAME || '').trim();
                                const secondaryName = String(SECONDARY_USER_FIRST_NAME || '').trim();
                                let callerName = 'legend';
                                if (currentCallerE164 && PRIMARY_CALLERS_SET.has(currentCallerE164) && primaryName) {
                                    callerName = primaryName;
                                } else if (currentCallerE164 && SECONDARY_CALLERS_SET.has(currentCallerE164) && secondaryName) {
                                    callerName = secondaryName;
                                }
                                // Send the personalized greeting to OpenAI to speak first
                                sendInitialConversationItem(callerName);
                                // Start initial wait music until first assistant audio, after a small threshold
                                if (!firstAssistantAudioReceived) {
                                    waitingMusicStartTimeout = setTimeout(() => {
                                        if (!firstAssistantAudioReceived && !isWaitingMusic) startWaitingMusic('initial');
                                    }, WAIT_MUSIC_THRESHOLD_MS);
                                }
                            } catch {
                                console.warn('No custom caller parameter found on start event.');
                                // Fallback greeting without a personalized name
                                sendInitialConversationItem('legend');
                                // Start initial wait music even without a personalized name
                                if (!firstAssistantAudioReceived) {
                                    waitingMusicStartTimeout = setTimeout(() => {
                                        if (!firstAssistantAudioReceived && !isWaitingMusic) startWaitingMusic('initial');
                                    }, WAIT_MUSIC_THRESHOLD_MS);
                                }
                            }
                            break;
                        case 'mark':
                            if (markQueue.length > 0) {
                                markQueue.shift();
                            }
                            // If a disconnect was requested, attempt closing once marks drain
                            attemptPendingDisconnectClose();
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
                // Enter silent mode and continue tool execution without streaming audio
                postHangupSilentMode = true;
                if (toolCallInProgress) hangupDuringTools = true;
                if (pendingDisconnectTimeout) {
                    clearTimeout(pendingDisconnectTimeout);
                    pendingDisconnectTimeout = null;
                }
                responseActive = false;
                // Clear any queued messages on close
                assistantSession.clearPendingMessages?.();
                stopWaitingMusic();
                clearWaitingMusicInterval();
                console.log('Client disconnected; silent mode enabled. Continuing tools and will notify via SMS.');
            });
}

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
