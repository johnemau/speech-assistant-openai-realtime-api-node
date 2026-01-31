import WebSocket from 'ws';
import fs from 'fs';
import path from 'node:path';
import {
    createAssistantSession,
    safeParseToolArguments,
} from '../assistant/session.js';
import {
    twilioClient,
    env,
    SHOW_TIMING_MATH as showTimingMath,
} from '../init.js';
import { readPcmuFile } from '../utils/audio.js';
import { getTimeGreeting } from '../utils/calls.js';
import { getLatestTrackTimezone } from '../utils/spot.js';
import { executeToolCall } from '../tools/index.js';
import { stringifyDeep } from '../utils/format.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import {
    IS_DEV,
    PRIMARY_CALLERS_SET,
    SECONDARY_CALLERS_SET,
    WAIT_MUSIC_FOLDER,
    WAIT_MUSIC_THRESHOLD_MS,
    PRIMARY_USER_FIRST_NAME,
    SECONDARY_USER_FIRST_NAME,
    getSpotFeedId,
    getSpotFeedPassword,
} from '../env.js';

/**
 * @param {import('ws').RawData} data - Raw WebSocket payload.
 * @returns {string} UTF-8 decoded message string.
 */
function toUtf8String(data) {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    return String(data);
}

/**
 * @param {NodeJS.Timeout | null} timer - Timer handle to unref.
 * @returns {void}
 */
function unrefTimer(timer) {
    if (timer && typeof timer.unref === 'function') {
        timer.unref();
    }
}

/**
 * @param {import('ws').WebSocket} connection - WebSocket connection for Twilio media stream.
 * @param {import('fastify').FastifyRequest} req - Incoming upgrade request.
 * @returns {void}
 */
export function mediaStreamHandler(connection, req) {
    console.log('Client connected');

    // Connection-specific state
    /** @type {string | null} */
    let streamSid = null;
    /** @type {string | null} */
    let currentCallerE164 = null;
    /** @type {string | null} */
    let currentTwilioNumberE164 = null;
    /** @type {string | null} */
    let currentCallSid = null;
    let latestMediaTimestamp = 0;
    /** @type {string | null} */
    let lastAssistantItem = null;
    let lastAssistantAudioBytes = 0;
    let lastAssistantAudioMs = 0;
    /** @type {string | null} */
    let lastAssistantAudioItemId = null;
    /** @type {string[]} */
    let markQueue = [];
    /** @type {number | null} */
    let responseStartTimestampTwilio = null;
    let pendingDisconnect = false;
    let pendingDisconnectResponseReceived = false;
    /** @type {NodeJS.Timeout | null} */
    let pendingDisconnectTimeout = null;
    // Track whether goodbye playback actually started before closing
    let disconnectAudioStarted = false;
    /** @type {{ callSid: string, destination_number: string, destination_label?: string } | null} */
    let pendingTransfer = null;
    let pendingTransferResponseReceived = false;
    let pendingTransferAudioStarted = false;
    let pendingTransferInFlight = false;
    let pendingTransferAnnouncementRequested = false;
    /** @type {string | null} */
    let pendingTransferAnnouncementResponseId = null;
    let pendingTransferAnnouncementAudioStartedAt = 0;
    /** @type {NodeJS.Timeout | null} */
    let pendingTransferTimeout = null;

    // Session duration tracking
    /** @type {NodeJS.Timeout | null} */
    let fiftyMinuteWarningTimeout = null;
    /** @type {NodeJS.Timeout | null} */
    let fiftyFiveMinuteHangupTimeout = null;
    let fiftyMinuteWarningSent = false;

    // Track response lifecycle to avoid overlapping response.create calls
    let responseActive = false;
    let responsePending = false;
    /** @type {{ reason: string }[]} */
    const responseQueue = [];
    const responseQueueSet = new Set();

    // One-time turn detection adjustment after initial greeting response
    let initialGreetingRequested = false;
    let initialTurnDetectionUpdated = false;

    // Post-hang-up behavior: suppress audio, continue tools, then SMS
    let postHangupSilentMode = false; // when true, do not send any audio back to Twilio
    let postHangupSmsSent = false; // ensure the completion SMS is sent at most once
    /** @type {string | null} */
    let lastWebSearchQuery = null; // capture recent query to summarize
    /** @type {string | null} */
    let lastEmailSubject = null; // capture subject to summarize
    let hangupDuringTools = false; // true if caller hung up while tools were pending/active

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
    /** @type {NodeJS.Timeout | null} */
    let waitingMusicInterval = null;
    /** @type {NodeJS.Timeout | null} */
    let waitingMusicStartTimeout = null;
    let toolCallInProgress = false;
    let pendingToolResponse = false;
    const QUICK_RESPONSE_SUPPRESSION_MS = 2000;
    // ffmpeg removed; we only support WAV files; no tone fallback
    /** @type {Buffer | null} */
    let waitingMusicUlawBuffer = null;
    let waitingMusicOffset = 0;
    /** @type {string | null} */
    let lastAssistantResponseItemId = null;
    let lastAssistantResponseStartedAt = 0;
    let resumeWaitingMusicAfterInterrupt = false;
    let isCallerSpeaking = false;

    function getWaitingMusicDelayMs() {
        const baseDelay = WAIT_MUSIC_THRESHOLD_MS;
        if (!lastAssistantResponseStartedAt) return baseDelay;
        const sinceLastResponse = Date.now() - lastAssistantResponseStartedAt;
        const suppressRemaining = Math.max(
            0,
            QUICK_RESPONSE_SUPPRESSION_MS - sinceLastResponse
        );
        const delay = Math.max(baseDelay, suppressRemaining);
        if (IS_DEV) {
            console.log('wait music delay computed', {
                baseDelay,
                sinceLastResponse,
                suppressRemaining,
                delay,
            });
        }
        return delay;
    }

    function scheduleWaitingMusic(reason = 'unknown') {
        if (isWaitingMusic || waitingMusicStartTimeout) return;
        if (isCallerSpeaking) return;
        const delayMs = getWaitingMusicDelayMs();
        if (IS_DEV) {
            console.log('wait music schedule requested', {
                reason,
                delayMs,
                isWaitingMusic,
                hasTimeout: Boolean(waitingMusicStartTimeout),
            });
        }
        waitingMusicStartTimeout = setTimeout(() => {
            waitingMusicStartTimeout = null;
            if (!isWaitingMusic) startWaitingMusic(reason);
        }, delayMs);
        unrefTimer(waitingMusicStartTimeout);
    }

    function startWaitingMusic(reason = 'unknown') {
        if (!streamSid || isWaitingMusic || isCallerSpeaking) return;
        isWaitingMusic = true;
        if (IS_DEV) {
            console.log('wait music start requested', {
                reason,
                streamSid,
                folder: WAIT_MUSIC_FOLDER || null,
            });
        }
        console.info(
            `wait music start: reason=${reason} streamSid=${streamSid || ''} thresholdMs=${WAIT_MUSIC_THRESHOLD_MS}`,
            {
                event: 'wait_music.start',
                reason,
                streamSid,
                threshold_ms: WAIT_MUSIC_THRESHOLD_MS,
            }
        );
        // If audio folder is provided and exists
        if (WAIT_MUSIC_FOLDER && fs.existsSync(WAIT_MUSIC_FOLDER)) {
            try {
                if (!waitingMusicUlawBuffer) {
                    const entries = fs.readdirSync(WAIT_MUSIC_FOLDER, {
                        withFileTypes: true,
                    });
                    const files = entries
                        .filter((entry) => entry.isFile())
                        .map((entry) =>
                            path.join(WAIT_MUSIC_FOLDER, entry.name)
                        );
                    if (files.length === 0) {
                        console.warn(
                            'Waiting music folder has no files; using silence frames.'
                        );
                    } else {
                        const selectedFile =
                            files[Math.floor(Math.random() * files.length)];
                        console.info(
                            'Waiting music file selected:',
                            selectedFile
                        );
                        // Read raw PCMU and pre-load into µ-law buffer
                        waitingMusicUlawBuffer = readPcmuFile(selectedFile);
                        waitingMusicOffset = 0;
                    }
                }
            } catch (e) {
                console.error(
                    'Failed to load waiting music file; using silence frames:',
                    e?.message || e
                );
            }
        }

        if (!waitingMusicUlawBuffer || waitingMusicUlawBuffer.length < 160) {
            // Silence fallback (µ-law 0xFF) to keep media flowing during tool calls.
            waitingMusicUlawBuffer = Buffer.alloc(1600, 0xff);
            waitingMusicOffset = 0;
        }

        if (!waitingMusicInterval) {
            waitingMusicInterval = setInterval(() => {
                if (
                    !isWaitingMusic ||
                    !streamSid ||
                    !waitingMusicUlawBuffer ||
                    waitingMusicUlawBuffer.length < 160
                )
                    return;
                const frameSize = 160; // 20ms @ 8kHz mono
                let end = waitingMusicOffset + frameSize;
                let frame;
                if (end <= waitingMusicUlawBuffer.length) {
                    frame = waitingMusicUlawBuffer.subarray(
                        waitingMusicOffset,
                        end
                    );
                } else {
                    const first =
                        waitingMusicUlawBuffer.subarray(waitingMusicOffset);
                    const rest = waitingMusicUlawBuffer.subarray(
                        0,
                        end - waitingMusicUlawBuffer.length
                    );
                    frame = Buffer.concat([first, rest]);
                }
                waitingMusicOffset = end % waitingMusicUlawBuffer.length;
                const payload = frame.toString('base64');
                // Send waiting music audio frame to Twilio Media Streams
                // This streams PCMU-encoded audio to keep the caller engaged during tool execution
                connection.send(
                    JSON.stringify({
                        event: 'media',
                        streamSid,
                        media: { payload },
                    })
                );
            }, 20);
            unrefTimer(waitingMusicInterval);
        }

        // No fallback tone; only raw PCMU or silence is supported for waiting music.
    }

    function stopWaitingMusic(reason = 'unknown') {
        if (waitingMusicStartTimeout) {
            clearTimeout(waitingMusicStartTimeout);
            waitingMusicStartTimeout = null;
        }
        if (
            toolCallInProgress &&
            (reason === 'assistant_audio' || reason === 'caller_speech')
        ) {
            resumeWaitingMusicAfterInterrupt = true;
        }
        if (isWaitingMusic) {
            isWaitingMusic = false;
            console.info(
                `wait music stop: reason=${reason} streamSid=${streamSid || ''}`,
                { event: 'wait_music.stop', reason, streamSid }
            );
        }
        const shouldResetTrack =
            reason === 'assistant_audio' ||
            reason === 'caller_speech' ||
            reason === 'new_stream' ||
            reason === 'disconnect' ||
            reason === 'openai_ws_close' ||
            reason === 'openai_ws_error';
        if (shouldResetTrack) {
            // Reset track selection when caller/AI interrupts or stream ends
            waitingMusicUlawBuffer = null;
            waitingMusicOffset = 0;
        }
        // Ensure any playback interval is cleared
        clearWaitingMusicInterval();
    }

    function clearWaitingMusicInterval() {
        if (waitingMusicInterval) {
            clearInterval(waitingMusicInterval);
            waitingMusicInterval = null;
        }
    }

    function attemptPendingDisconnectClose({ force = false } = {}) {
        try {
            if (!pendingDisconnect) return;
            if (!force && !pendingDisconnectResponseReceived) return;
            // Ensure we have started playing the goodbye audio at least once
            if (!force && !disconnectAudioStarted) return;
            // Prefer closing after Twilio marks catch up (no queued marks)
            if (!force && markQueue.length !== 0) return;

            if (force && IS_DEV)
                console.warn('Forcing call disconnect after timeout.');

            pendingDisconnect = false;
            pendingDisconnectResponseReceived = false;
            if (pendingDisconnectTimeout) {
                clearTimeout(pendingDisconnectTimeout);
                pendingDisconnectTimeout = null;
            }
            stopWaitingMusic('disconnect');
            clearWaitingMusicInterval();
            try {
                connection.close(1000, 'Call ended by assistant');
            } catch {
                // noop: connection may already be closed
                void 0;
            }
            try {
                if (assistantSession.openAiWs?.readyState === WebSocket.OPEN)
                    assistantSession.close();
            } catch {
                // noop: websocket may already be closed
                void 0;
            }
            console.log('Call closed after goodbye playback.');
        } catch (e) {
            console.warn(
                'Attempt to close pending disconnect failed:',
                e?.message || e
            );
        }
    }

    /**
     * @param {string} number - Destination number to announce.
     * @returns {string} Number formatted for announcement.
     */
    function formatTransferAnnouncementNumber(number) {
        const trimmed = String(number || '').trim();
        if (!trimmed) return trimmed;
        const isUsCaller = Boolean(
            currentCallerE164 && String(currentCallerE164).startsWith('+1')
        );
        if (isUsCaller && trimmed.startsWith('+1')) {
            return trimmed.replace(/^\+1\s*/, '').trim();
        }
        return trimmed;
    }

    async function attemptPendingTransferUpdate({ force = false } = {}) {
        try {
            if (!pendingTransfer) return;
            if (pendingTransferInFlight) return;
            if (postHangupSilentMode) return;
            if (!force && !pendingTransferResponseReceived) return;
            if (!force && !pendingTransferAudioStarted) return;
            if (!force && pendingTransferAnnouncementAudioStartedAt) {
                const elapsedMs =
                    Date.now() - pendingTransferAnnouncementAudioStartedAt;
                if (elapsedMs < 1200) return;
            }
            if (!force && markQueue.length !== 0) return;

            const transfer = pendingTransfer;
            pendingTransferInFlight = true;
            pendingTransfer = null;
            pendingTransferResponseReceived = false;
            pendingTransferAudioStarted = false;
            pendingTransferAnnouncementAudioStartedAt = 0;
            if (pendingTransferTimeout) {
                clearTimeout(pendingTransferTimeout);
                pendingTransferTimeout = null;
            }

            if (!transfer.callSid || !transfer.destination_number) {
                console.warn('Pending transfer missing callSid/number.');
                pendingTransferInFlight = false;
                return;
            }
            if (!twilioClient) {
                console.warn('Twilio client unavailable for transfer_call.');
                pendingTransferInFlight = false;
                return;
            }

            if (IS_DEV) {
                console.log('transfer_call: updating Twilio call', {
                    callSid: transfer.callSid,
                    destination: transfer.destination_number,
                });
            }

            await twilioClient.calls(transfer.callSid).update({
                twiml: `<Response><Dial>${transfer.destination_number}</Dial></Response>`,
            });

            try {
                connection.close(1000, 'Call transferred by assistant');
            } catch {
                void 0;
            }
            try {
                if (assistantSession.openAiWs?.readyState === WebSocket.OPEN)
                    assistantSession.close();
            } catch {
                void 0;
            }
        } catch (e) {
            console.warn(
                'Attempt to update pending transfer failed:',
                e?.message || e
            );
        } finally {
            pendingTransferInFlight = false;
        }
    }

    /**
     * @param {{ type?: string, delta?: string, itemId?: string }} payload - Assistant output event payload.
     */
    const handleAssistantOutput = (payload) => {
        if (payload?.type !== 'audio' || !payload?.delta) return;
        if (payload.itemId && payload.itemId !== lastAssistantAudioItemId) {
            lastAssistantAudioItemId = payload.itemId;
            lastAssistantAudioBytes = 0;
            lastAssistantAudioMs = 0;
        }
        const deltaBytes = Buffer.from(payload.delta, 'base64').length;
        lastAssistantAudioBytes += deltaBytes;
        lastAssistantAudioMs = Math.floor(lastAssistantAudioBytes / 8);
        if (payload.itemId && payload.itemId !== lastAssistantResponseItemId) {
            lastAssistantResponseItemId = payload.itemId;
            lastAssistantResponseStartedAt = Date.now();
        }
        // Suppress audio entirely after hang-up; otherwise, stream to Twilio
        // Assistant audio is streaming; stop any waiting music immediately
        stopWaitingMusic('assistant_audio');
        // Mark that goodbye audio has started when pending disconnect
        if (pendingDisconnect) disconnectAudioStarted = true;
        if (pendingTransfer) {
            pendingTransferAudioStarted = true;
            if (!pendingTransferAnnouncementAudioStartedAt) {
                pendingTransferAnnouncementAudioStartedAt = Date.now();
            }
        }
        if (!postHangupSilentMode) {
            const audioDelta = {
                event: 'media',
                streamSid: streamSid,
                media: { payload: payload.delta },
            };
            // Send assistant audio response chunk to Twilio Media Streams
            // This streams OpenAI Realtime API audio output back to the caller in real-time
            connection.send(JSON.stringify(audioDelta));

            // First delta from a new response starts the elapsed time counter
            if (!responseStartTimestampTwilio) {
                responseStartTimestampTwilio = latestMediaTimestamp;
                if (showTimingMath)
                    console.log(
                        `Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`
                    );
            }

            if (payload.itemId) {
                lastAssistantItem = payload.itemId;
            }

            sendMark(connection, streamSid);
        }
    };

    /** @param {any} response - Raw OpenAI event payload. */
    const handleOpenAiEvent = (response) => {
        if (LOG_EVENT_TYPES.includes(response.type)) {
            if (IS_DEV)
                console.log(`Received event: ${response.type}`, response);
            else console.log(`Received event: ${response.type}`);
        }

        // Track response lifecycle to avoid overlapping creates
        if (response.type === 'response.created') {
            responseActive = true;
            responsePending = false;
            if (
                pendingTransfer &&
                pendingTransferAnnouncementRequested &&
                !pendingTransferAnnouncementResponseId
            ) {
                const createdResponseId =
                    response?.response?.id || response?.id || null;
                if (createdResponseId) {
                    pendingTransferAnnouncementResponseId = createdResponseId;
                    if (IS_DEV) {
                        console.log(
                            'transfer_call: announcement response created',
                            {
                                responseId: createdResponseId,
                            }
                        );
                    }
                }
            }
        }
        if (response.type === 'response.done') {
            responseActive = false;
            responsePending = false;
            if (pendingTransferAnnouncementResponseId) {
                const doneResponseId =
                    response?.response?.id || response?.id || null;
                if (
                    doneResponseId &&
                    doneResponseId === pendingTransferAnnouncementResponseId
                ) {
                    pendingTransferResponseReceived = true;
                    pendingTransferAnnouncementRequested = false;
                    pendingTransferAnnouncementResponseId = null;
                    void attemptPendingTransferUpdate();
                }
            }

            if (initialGreetingRequested && !initialTurnDetectionUpdated) {
                initialTurnDetectionUpdated = true;
                try {
                    assistantSession.updateSession({
                        audio: {
                            input: {
                                turn_detection: {
                                    type: 'semantic_vad',
                                    eagerness: 'low',
                                    interrupt_response: true,
                                    create_response: false,
                                },
                            },
                        },
                    });
                    console.log(
                        'Turn detection updated after initial greeting response.'
                    );
                } catch (e) {
                    console.warn(
                        'Failed to update turn detection after initial greeting:',
                        e?.message || e
                    );
                }
            }
        }

        // When VAD ends a user turn, we must explicitly create a response (auto-create disabled)
        if (response.type === 'input_audio_buffer.speech_stopped') {
            isCallerSpeaking = false;
            // During an assistant-initiated hangup, do not request another response
            if (pendingDisconnect) return;
            stopWaitingMusic('speech_stopped');
            if (toolCallInProgress) {
                scheduleWaitingMusic('caller_done_speaking');
                resumeWaitingMusicAfterInterrupt = false;
            }
            if (responseActive && !toolCallInProgress) {
                scheduleWaitingMusic('model_response_pending');
            }
            if (!responseActive) {
                try {
                    if (responseQueue.length > 0) {
                        drainResponseQueue('speech_stopped');
                    } else {
                        requestResponseQueued('speech_stopped');
                    }
                    scheduleWaitingMusic('speech_stopped');
                } catch (e) {
                    console.warn(
                        'Failed to request response.create after speech_stopped:',
                        e?.message || e
                    );
                }
            }
            if (resumeWaitingMusicAfterInterrupt && toolCallInProgress) {
                scheduleWaitingMusic('tool_wait_resume_speech');
                resumeWaitingMusicAfterInterrupt = false;
            }
        }

        if (response.type === 'input_audio_buffer.speech_started') {
            isCallerSpeaking = true;
            // Caller barged in; stop waiting music and handle truncation
            stopWaitingMusic('caller_speech');
            if (toolCallInProgress) {
                resumeWaitingMusicAfterInterrupt = true;
            }
            handleSpeechStartedEvent();
        }

        if (response.type === 'response.done') {
            const functionCall = response.response?.output?.[0];
            if (!functionCall || functionCall?.type !== 'function_call') {
                if (pendingDisconnect) {
                    pendingDisconnectResponseReceived = true;
                }
                // Non-function responses: if we were asked to end the call, close after playback finishes
                attemptPendingDisconnectClose();
                // If in silent mode and no tool call is active, send a completion SMS and close OpenAI WS
                if (
                    postHangupSilentMode &&
                    !toolCallInProgress &&
                    !postHangupSmsSent
                ) {
                    // Send SMS only if tools were in progress during hangup
                    if (hangupDuringTools) {
                        try {
                            const toNumber = currentCallerE164;
                            const envFrom = normalizeUSNumberToE164(
                                env?.TWILIO_SMS_FROM_NUMBER || ''
                            );
                            const fromNumber =
                                currentTwilioNumberE164 || envFrom;
                            if (twilioClient && toNumber && fromNumber) {
                                const subjectNote = lastEmailSubject
                                    ? ` Email sent: "${lastEmailSubject}".`
                                    : '';
                                const body = `Your request is complete.${subjectNote}`;
                                if (IS_DEV)
                                    console.log(
                                        'Post-hang-up completion SMS:',
                                        {
                                            from: fromNumber,
                                            to: toNumber,
                                            body,
                                        }
                                    );
                                twilioClient.messages
                                    .create({
                                        from: fromNumber,
                                        to: toNumber,
                                        body,
                                    })
                                    .then((sendRes) => {
                                        console.info(
                                            `posthangup SMS sent: sid=${sendRes?.sid || ''} to=${toNumber || ''}`,
                                            {
                                                event: 'posthangup.sms.sent',
                                                sid: sendRes?.sid,
                                                to: toNumber,
                                            }
                                        );
                                    })
                                    .catch((e) => {
                                        console.warn(
                                            'Post-hang-up SMS send error:',
                                            e?.message || e
                                        );
                                    });
                                postHangupSmsSent = true;
                            } else {
                                console.warn(
                                    `posthangup SMS unavailable: to=${toNumber || ''} from=${fromNumber || ''}`,
                                    {
                                        event: 'posthangup.sms.unavailable',
                                        to: toNumber,
                                        from: fromNumber,
                                    }
                                );
                            }
                        } catch (e) {
                            console.warn(
                                'Post-hang-up SMS error:',
                                e?.message || e
                            );
                        }
                    }
                    // Close OpenAI WS after all tools complete (with or without SMS)
                    console.log(
                        'Closing OpenAI session: all tools completed after hangup'
                    );
                    try {
                        if (
                            assistantSession.openAiWs?.readyState ===
                            WebSocket.OPEN
                        )
                            assistantSession.close();
                    } catch {
                        // noop: websocket may already be closed
                        void 0;
                    }
                }
            }
            if (resumeWaitingMusicAfterInterrupt && toolCallInProgress) {
                scheduleWaitingMusic('tool_wait_resume_response');
                resumeWaitingMusicAfterInterrupt = false;
            }
            if (!functionCall || functionCall?.type !== 'function_call') {
                if (
                    toolCallInProgress &&
                    !isCallerSpeaking &&
                    !postHangupSilentMode &&
                    !pendingDisconnect
                ) {
                    scheduleWaitingMusic('tool_call_pending_response_done');
                }
                if (pendingToolResponse && !toolCallInProgress) {
                    pendingToolResponse = false;
                    drainResponseQueue('tool_call_response_deferred');
                }
                drainResponseQueue('response_done');
            }
        }
    };

    /**
     * Enqueue a response request when one is already active/pending.
     * @param {string} reason - Reason for logging.
     */
    const requestResponseQueued = (reason = 'unknown') => {
        enqueueResponse(reason);
        if (responseActive || responsePending || isCallerSpeaking) {
            if (IS_DEV) {
                console.log(
                    'response.create queued (active/pending/speaking)',
                    {
                        reason,
                        responseActive,
                        responsePending,
                        isCallerSpeaking,
                    }
                );
            }
            return;
        }
        drainResponseQueue(reason);
    };

    /**
     * Request a response for tool output, deferring until current response finishes if needed.
     * @param {string} reason - Reason for logging.
     */
    const requestToolFollowup = (reason = 'tool_call_response') => {
        enqueueResponse(reason);
        if (responseActive || responsePending || isCallerSpeaking) {
            pendingToolResponse = true;
            if (IS_DEV) {
                console.log(
                    'tool response deferred (active/pending/speaking)',
                    {
                        reason,
                        responseActive,
                        responsePending,
                        isCallerSpeaking,
                    }
                );
            }
            return;
        }
        drainResponseQueue(reason);
        if (!responseActive && !isCallerSpeaking) {
            scheduleWaitingMusic(reason);
        }
    };

    /**
     * @param {string} reason - Response reason to enqueue.
     */
    const enqueueResponse = (reason) => {
        if (responseQueueSet.has(reason)) return;
        responseQueueSet.add(reason);
        responseQueue.push({ reason });
    };

    /**
     * @param {string} reason - Reason for draining.
     */
    const drainResponseQueue = (reason = 'unknown') => {
        if (responseActive || responsePending) return;
        if (isCallerSpeaking) return;
        if (responseQueue.length === 0) return;
        const next = responseQueue.shift();
        if (!next) return;
        responseQueueSet.delete(next.reason);
        if (IS_DEV) {
            console.log('response.create dequeued', {
                reason,
                next: next.reason,
                remaining: responseQueue.length,
            });
        }
        responsePending = true;
        assistantSession.requestResponse();
    };

    /** @param {any} functionCall - Function call payload from OpenAI. */
    const handleToolCall = async (functionCall) => {
        console.log('Function call detected:', functionCall.name);
        const callId = functionCall.call_id;
        if (!callId) {
            console.warn(
                'Function call missing call_id; skipping to prevent duplicate execution.'
            );
            return;
        }

        const toolName = functionCall.name;
        toolCallInProgress = true;
        scheduleWaitingMusic(`tool_call:${toolName}`);

        let toolInput = null;
        try {
            toolInput = safeParseToolArguments(functionCall.arguments);
            if (postHangupSilentMode) hangupDuringTools = true;
            if (toolName === 'gpt_web_search') {
                const queryValue =
                    typeof toolInput?.query === 'string'
                        ? toolInput.query
                        : null;
                lastWebSearchQuery = queryValue || lastWebSearchQuery;
            }
            if (toolName === 'send_email') {
                const subjectRaw = String(toolInput?.subject || '').trim();
                if (subjectRaw) lastEmailSubject = subjectRaw;
            }

            const toolContext = {
                currentCallerE164,
                currentTwilioNumberE164,
                currentCallSid,
                micState,
                /**
                 * @param {'near_field' | 'far_field'} mode - Noise reduction mode.
                 * @returns {void}
                 */
                applyNoiseReduction: (mode) => {
                    const sessionUpdate = {
                        audio: {
                            input: {
                                noise_reduction: { type: mode },
                            },
                        },
                    };
                    if (IS_DEV)
                        console.log(
                            'Applying noise_reduction change:',
                            sessionUpdate
                        );
                    assistantSession.updateSession(sessionUpdate);
                },
                /**
                 * @param {{ reason?: string }} root0 - End-call inputs.
                 * @returns {{ status: string, pending_disconnect: boolean, reason?: string, silent: boolean }} End-call result.
                 */
                onEndCall: ({ reason }) => {
                    pendingDisconnect = true;
                    pendingDisconnectResponseReceived = false;
                    if (!pendingDisconnectTimeout) {
                        pendingDisconnectTimeout = setTimeout(() => {
                            attemptPendingDisconnectClose({ force: true });
                        }, 10_000);
                        unrefTimer(pendingDisconnectTimeout);
                    }
                    return {
                        status: 'ok',
                        pending_disconnect: true,
                        reason,
                        silent: false,
                    };
                },
                /**
                 * @param {{ destination_number: string, destination_label?: string }} root0 - Transfer inputs.
                 * @returns {{ status: string, call_sid?: string, destination_number?: string, destination_label?: string }} Transfer result.
                 */
                onTransferCall: ({ destination_number, destination_label }) => {
                    if (!currentCallSid) {
                        return {
                            status: 'error',
                            call_sid: currentCallSid || undefined,
                        };
                    }
                    pendingTransfer = {
                        callSid: currentCallSid,
                        destination_number,
                        destination_label,
                    };
                    pendingTransferResponseReceived = false;
                    pendingTransferAudioStarted = false;
                    if (!pendingTransferTimeout) {
                        pendingTransferTimeout = setTimeout(() => {
                            void attemptPendingTransferUpdate({ force: true });
                        }, 5_000);
                        unrefTimer(pendingTransferTimeout);
                    }
                    if (IS_DEV) {
                        console.log('transfer_call: pending transfer queued', {
                            callSid: currentCallSid,
                            destination_number,
                            destination_label,
                        });
                    }
                    return {
                        status: 'pending',
                        call_sid: currentCallSid,
                        destination_number,
                        destination_label,
                    };
                },
            };

            if (toolName === 'end_call') {
                const reason =
                    typeof toolInput?.reason === 'string'
                        ? toolInput.reason.trim()
                        : undefined;
                const output = toolContext.onEndCall
                    ? toolContext.onEndCall({ reason })
                    : { status: 'ok', reason };
                const toolResultEvent = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: functionCall.call_id,
                        output: JSON.stringify(output),
                    },
                };
                toolCallInProgress = false;
                assistantSession.send(toolResultEvent);
                requestToolFollowup('tool_call_response');
                if (IS_DEV)
                    console.log(
                        'LLM tool output sent to OpenAI',
                        toolResultEvent
                    );
                return;
            }

            const output = await executeToolCall({
                name: toolName,
                args: toolInput,
                context: toolContext,
            });

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
                    output: JSON.stringify(output),
                },
            };
            toolCallInProgress = false;
            // Do not stop waiting music here; keep it playing until
            // assistant audio resumes or the caller speaks.
            assistantSession.send(toolResultEvent);
            if (toolName === 'transfer_call') {
                const transferOutput = /** @type {any} */ (output);
                const destinationNumber =
                    typeof transferOutput?.destination_number === 'string'
                        ? transferOutput.destination_number
                        : null;
                const destinationLabel =
                    typeof transferOutput?.destination_label === 'string'
                        ? transferOutput.destination_label
                        : null;
                if (destinationNumber) {
                    const announceNumber =
                        formatTransferAnnouncementNumber(destinationNumber);
                    const announceText = destinationLabel
                        ? `Tell the caller: "I found ${destinationLabel}. Connecting you now at ${announceNumber}." Use the exact number string shown.`
                        : `Tell the caller: "Connecting you now at ${announceNumber}." Use the exact number string shown.`;
                    assistantSession.send({
                        type: 'conversation.item.create',
                        item: {
                            type: 'message',
                            role: 'user',
                            content: [
                                {
                                    type: 'input_text',
                                    text: announceText,
                                },
                            ],
                        },
                    });
                    pendingTransferAnnouncementRequested = true;
                } else if (IS_DEV) {
                    console.warn(
                        'transfer_call missing destination_number for announcement.'
                    );
                }
            }
            // After end_call, only request a single goodbye response
            const shouldRequest = !pendingDisconnect || toolName === 'end_call';
            if (shouldRequest) {
                requestToolFollowup('tool_call_response');
            }
            if (IS_DEV)
                console.log('LLM tool output sent to OpenAI', toolResultEvent);
        } catch (error) {
            console.error('Error handling tool call:', error);
            toolCallInProgress = false;
            if (toolName === 'transfer_call') {
                const msg =
                    typeof error === 'string'
                        ? error
                        : /** @type {any} */ (error)?.message || '';
                if (
                    msg.includes('Invalid destination_number') ||
                    msg.includes('Missing destination_number')
                ) {
                    const invalidMatch = msg.match(
                        /Invalid destination_number:\s*"([\s\S]*)"/
                    );
                    const invalidValue =
                        invalidMatch?.[1] ||
                        (typeof toolInput?.destination_number === 'string'
                            ? toolInput.destination_number
                            : undefined);
                    const promptText = invalidValue
                        ? `The number "${invalidValue}" looks invalid. Ask the caller to provide the correct number to call.`
                        : 'The number provided does not look valid. Ask the caller to confirm or provide the correct number to call.';
                    assistantSession.send({
                        type: 'conversation.item.create',
                        item: {
                            type: 'message',
                            role: 'user',
                            content: [
                                {
                                    type: 'input_text',
                                    text: promptText,
                                },
                            ],
                        },
                    });
                }
            }
            // Keep waiting music active during error handling until
            // the assistant produces audio or another interrupt occurs.
            sendOpenAiToolError(functionCall.call_id, error);
        }
    };

    const assistantSession = createAssistantSession({
        onEvent: handleOpenAiEvent,
        onAssistantOutput: handleAssistantOutput,
        onToolCall: handleToolCall,
        onOpen: () => console.log('Connected to the OpenAI Realtime API'),
        onClose: () => {
            console.log('Disconnected from the OpenAI Realtime API');
            stopWaitingMusic('openai_ws_close');
            clearWaitingMusicInterval();
        },
        onError: (error) => {
            console.error('Error in the OpenAI WebSocket:', error);
            stopWaitingMusic('openai_ws_error');
            clearWaitingMusicInterval();
        },
    });

    // Send initial conversation item using the caller's name once available
    const sendInitialConversationItem = async (callerNameValue = 'legend') => {
        initialGreetingRequested = true;
        let timeZone = 'America/Los_Angeles';
        if (IS_DEV) {
            console.log('initial greeting: start', {
                callerNameValue,
                currentCallerE164,
                defaultTimeZone: timeZone,
            });
        }
        try {
            const shouldLookupTimezone =
                currentCallerE164 && PRIMARY_CALLERS_SET.has(currentCallerE164);
            const hasSpotCredentials = Boolean(
                getSpotFeedId() && getSpotFeedPassword()
            );
            if (shouldLookupTimezone && hasSpotCredentials) {
                const trackTimezone = await getLatestTrackTimezone();
                if (trackTimezone?.timezoneId) {
                    timeZone = trackTimezone.timezoneId;
                }
                if (IS_DEV) {
                    console.log('initial greeting: timezone lookup', {
                        shouldLookupTimezone,
                        resolvedTimeZone: trackTimezone?.timezoneId || null,
                    });
                }
            } else if (IS_DEV) {
                console.log('initial greeting: timezone lookup skipped', {
                    shouldLookupTimezone,
                    hasSpotCredentials,
                });
            }
        } catch (e) {
            if (IS_DEV) {
                console.warn(
                    'Failed to resolve track timezone; using default:',
                    e?.message || e
                );
            }
        }
        const timeGreeting = getTimeGreeting({ timeZone });
        if (IS_DEV) {
            console.log('initial greeting: prepared', {
                timeZone,
                timeGreeting,
            });
        }
        const initialConversationItem = {
            type: 'conversation.item.create',
            item: {
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: `Start the greeting with "${timeGreeting}" and immediately say the caller name "${callerNameValue}" with NO comma or pause between them (e.g., "${timeGreeting} ${callerNameValue}"). Speak slightly faster for THIS initial greeting only. Single concise butler/service‑worker style line; light and optionally witty; always include the name and the time greeting.`,
                    },
                ],
            },
        };

        if (showTimingMath)
            console.log(
                'Sending initial conversation item:',
                JSON.stringify(initialConversationItem)
            );
        assistantSession.send(initialConversationItem);
        requestResponseQueued('initial_greeting');
        scheduleWaitingMusic('initial_greeting');
    };

    // Helper to log and send tool errors to OpenAI WS
    /**
     * @param {string} callId - Tool call identifier.
     * @param {unknown} errorLike - Error payload or message.
     */
    function sendOpenAiToolError(callId, errorLike) {
        const msg =
            typeof errorLike === 'string'
                ? errorLike
                : /** @type {any} */ (errorLike)?.message || String(errorLike);
        if (IS_DEV) {
            console.log('tool error: sending to OpenAI', {
                callId,
                message: msg,
            });
        }
        try {
            console.error('Sending tool error to OpenAI WS:', msg);
            const toolErrorEvent = {
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: callId,
                    output: JSON.stringify({ error: msg }),
                },
            };
            assistantSession.send(toolErrorEvent);
            if (!pendingDisconnect) {
                requestToolFollowup('tool_call_error');
            }
        } catch (e) {
            console.error('Failed to send tool error to OpenAI WS:', e);
        }
    }

    // Handle interruption when the caller's speech starts
    const handleSpeechStartedEvent = () => {
        if (IS_DEV) {
            console.log('speech started event', {
                markQueueLength: markQueue.length,
                responseStartTimestampTwilio,
                lastAssistantItem,
                latestMediaTimestamp,
            });
        }
        if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
            const elapsedTime =
                latestMediaTimestamp - responseStartTimestampTwilio;
            if (showTimingMath)
                console.log(
                    `Calculating elapsed time for truncation: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`
                );

            if (lastAssistantItem) {
                let audioEndMs = null;
                if (
                    lastAssistantAudioItemId === lastAssistantItem &&
                    lastAssistantAudioMs > 0
                ) {
                    audioEndMs = Math.min(elapsedTime, lastAssistantAudioMs);
                }
                if (
                    audioEndMs != null &&
                    Number.isFinite(audioEndMs) &&
                    audioEndMs > 0
                ) {
                    const truncateEvent = {
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: audioEndMs,
                    };
                    if (showTimingMath)
                        console.log(
                            'Sending truncation event:',
                            stringifyDeep(truncateEvent)
                        );
                    assistantSession.send(truncateEvent);
                } else if (IS_DEV) {
                    console.log(
                        'Skipping truncation; invalid audio_end_ms computed.',
                        {
                            lastAssistantItem,
                            lastAssistantAudioMs,
                            elapsedTime,
                        }
                    );
                }
            }

            // Send clear event to Twilio to flush its audio buffer
            // This prevents overlapping audio when the caller interrupts the assistant mid-response
            connection.send(
                JSON.stringify({
                    event: 'clear',
                    streamSid: streamSid,
                })
            );

            // Reset
            markQueue = [];
            lastAssistantItem = null;
            lastAssistantAudioBytes = 0;
            lastAssistantAudioMs = 0;
            lastAssistantAudioItemId = null;
            responseStartTimestampTwilio = null;
        }
    };

    /**
     * Send mark messages to Media Streams so we know if and when AI response playback is finished
     * @param {import('ws').WebSocket} connection - Twilio WebSocket connection.
     * @param {string | null} streamSid - Active stream SID.
     */
    const sendMark = (connection, streamSid) => {
        if (streamSid) {
            const markEvent = {
                event: 'mark',
                streamSid: streamSid,
                mark: { name: 'responsePart' },
            };
            // Send mark event to Twilio to track when audio playback completes
            // Twilio echoes this back, allowing us to detect when the caller has heard all audio
            connection.send(JSON.stringify(markEvent));
            markQueue.push('responsePart');
        }
    };

    // Handle incoming messages from Twilio
    connection.on('message', (message) => {
        const rawMessage = toUtf8String(message);
        try {
            const data = JSON.parse(rawMessage);

            switch (data.event) {
                case 'media': {
                    latestMediaTimestamp = data.media.timestamp;
                    const audioAppend = {
                        type: 'input_audio_buffer.append',
                        audio: data.media.payload,
                    };
                    assistantSession.send(audioAppend);
                    break;
                }
                case 'start':
                    streamSid = data.start.streamSid;
                    console.log('Incoming stream has started', streamSid);

                    // Reset start and media timestamp on a new stream
                    responseStartTimestampTwilio = null;
                    latestMediaTimestamp = 0;
                    // Ensure waiting music is not running for a new stream
                    stopWaitingMusic('new_stream');
                    clearWaitingMusicInterval();

                    // Start session duration tracking and reset warning state
                    fiftyMinuteWarningSent = false;

                    // Schedule 50-minute warning
                    fiftyMinuteWarningTimeout = setTimeout(
                        () => {
                            if (
                                !fiftyMinuteWarningSent &&
                                !pendingDisconnect &&
                                !postHangupSilentMode
                            ) {
                                fiftyMinuteWarningSent = true;
                                console.log(
                                    'Session duration: 50 minutes reached, sending time warning'
                                );
                                const warningItem = {
                                    type: 'conversation.item.create',
                                    item: {
                                        type: 'message',
                                        role: 'user',
                                        content: [
                                            {
                                                type: 'input_text',
                                                text: 'Politely inform the caller that there are only 5 minutes remaining in this call session.',
                                            },
                                        ],
                                    },
                                };
                                assistantSession.send(warningItem);
                                if (!responseActive) {
                                    requestResponseQueued(
                                        'fifty_minute_warning'
                                    );
                                }
                            }
                        },
                        50 * 60 * 1000
                    ); // 50 minutes
                    unrefTimer(fiftyMinuteWarningTimeout);

                    // Schedule 55-minute graceful hangup
                    fiftyFiveMinuteHangupTimeout = setTimeout(
                        () => {
                            if (!pendingDisconnect && !postHangupSilentMode) {
                                console.log(
                                    'Session duration: 55 minutes reached, initiating graceful hangup'
                                );
                                const hangupItem = {
                                    type: 'conversation.item.create',
                                    item: {
                                        type: 'message',
                                        role: 'user',
                                        content: [
                                            {
                                                type: 'input_text',
                                                text: 'The maximum call duration has been reached. Politely inform the caller and end the call gracefully.',
                                            },
                                        ],
                                    },
                                };
                                assistantSession.send(hangupItem);
                                if (!responseActive) {
                                    requestResponseQueued(
                                        'fifty_five_minute_hangup'
                                    );
                                }
                                // Trigger end_call after assistant responds
                                const hangupGraceTimeout = setTimeout(() => {
                                    if (!pendingDisconnect) {
                                        pendingDisconnect = true;
                                        pendingDisconnectResponseReceived = false;
                                        if (!pendingDisconnectTimeout) {
                                            pendingDisconnectTimeout =
                                                setTimeout(() => {
                                                    attemptPendingDisconnectClose(
                                                        {
                                                            force: true,
                                                        }
                                                    );
                                                }, 10_000);
                                            unrefTimer(
                                                pendingDisconnectTimeout
                                            );
                                        }
                                        console.log(
                                            'Ending call due to 55-minute limit: pending_disconnect set'
                                        );
                                    }
                                }, 3000); // Give assistant 3 seconds to start speaking
                                unrefTimer(hangupGraceTimeout);
                            }
                        },
                        55 * 60 * 1000
                    ); // 55 minutes
                    unrefTimer(fiftyFiveMinuteHangupTimeout);

                    // Read caller number from custom parameters passed via TwiML Parameter
                    try {
                        const cp =
                            data.start?.customParameters ||
                            data.start?.custom_parameters ||
                            {};
                        const rawCaller =
                            cp.caller_number || cp.callerNumber || null;
                        currentCallerE164 = normalizeUSNumberToE164(rawCaller);
                        if (currentCallerE164)
                            console.log(
                                'Caller (from TwiML Parameter):',
                                rawCaller,
                                '=>',
                                currentCallerE164
                            );
                        const rawTwilioNum =
                            cp.twilio_number || cp.twilioNumber || null;
                        currentTwilioNumberE164 =
                            normalizeUSNumberToE164(rawTwilioNum);
                        if (currentTwilioNumberE164)
                            console.log(
                                'Twilio number (from TwiML Parameter):',
                                rawTwilioNum,
                                '=>',
                                currentTwilioNumberE164
                            );
                        const rawCallSid =
                            data.start?.callSid ||
                            data.start?.call_sid ||
                            cp.call_sid ||
                            cp.callSid ||
                            null;
                        currentCallSid =
                            typeof rawCallSid === 'string' && rawCallSid.trim()
                                ? rawCallSid.trim()
                                : null;
                        if (currentCallSid && IS_DEV) {
                            console.log('CallSid captured:', currentCallSid);
                        }
                        // Compute caller name based on group and send initial greeting
                        const primaryName = String(
                            PRIMARY_USER_FIRST_NAME || ''
                        ).trim();
                        const secondaryName = String(
                            SECONDARY_USER_FIRST_NAME || ''
                        ).trim();
                        let callerName = 'legend';
                        if (
                            currentCallerE164 &&
                            PRIMARY_CALLERS_SET.has(currentCallerE164) &&
                            primaryName
                        ) {
                            callerName = primaryName;
                        } else if (
                            currentCallerE164 &&
                            SECONDARY_CALLERS_SET.has(currentCallerE164) &&
                            secondaryName
                        ) {
                            callerName = secondaryName;
                        }
                        // Send the personalized greeting to OpenAI to speak first
                        void sendInitialConversationItem(callerName);
                    } catch {
                        // noop: missing custom parameters should not break stream handling
                        void 0;
                        console.warn(
                            'No custom caller parameter found on start event.'
                        );
                        // Fallback greeting without a personalized name
                        void sendInitialConversationItem('legend');
                    }
                    break;
                case 'mark':
                    if (markQueue.length > 0) {
                        markQueue.shift();
                    }
                    // If a disconnect was requested, attempt closing once marks drain
                    attemptPendingDisconnectClose();
                    void attemptPendingTransferUpdate();
                    break;
                case 'stop':
                    console.log('Twilio stream stop event received');
                    // Twilio is ending the stream; clean up waiting music and prepare for disconnect
                    stopWaitingMusic('twilio_stop');
                    clearWaitingMusicInterval();
                    // Enter silent mode to allow any in-flight tools to complete
                    postHangupSilentMode = true;
                    if (toolCallInProgress) hangupDuringTools = true;
                    pendingTransfer = null;
                    pendingTransferResponseReceived = false;
                    pendingTransferAudioStarted = false;
                    pendingTransferInFlight = false;
                    pendingTransferAnnouncementRequested = false;
                    pendingTransferAnnouncementResponseId = null;
                    pendingTransferAnnouncementAudioStartedAt = 0;
                    if (pendingTransferTimeout) {
                        clearTimeout(pendingTransferTimeout);
                        pendingTransferTimeout = null;
                    }
                    break;
                default:
                    console.log('Received non-media event:', data.event);
                    break;
            }
        } catch (error) {
            if (IS_DEV) {
                console.error(
                    'Twilio message JSON parse failed (raw):',
                    rawMessage
                );
            }
            console.error('Error parsing message:', error, 'Message:', message);
        }
    });

    // Handle connection close
    connection.on('close', () => {
        // Enter silent mode and continue tool execution without streaming audio
        postHangupSilentMode = true;
        if (toolCallInProgress) {
            hangupDuringTools = true;
            console.log(
                'Client disconnected with tools in progress; silent mode enabled. Will notify via SMS after completion.'
            );
        } else {
            // No tools in progress; close OpenAI session immediately
            console.log(
                'Client disconnected with no active tools; closing OpenAI session immediately.'
            );
            try {
                if (assistantSession.openAiWs?.readyState === WebSocket.OPEN) {
                    assistantSession.close();
                }
            } catch {
                // noop: websocket may already be closed
                void 0;
            }
        }
        if (pendingDisconnectTimeout) {
            clearTimeout(pendingDisconnectTimeout);
            pendingDisconnectTimeout = null;
        }
        // Clear session duration timers
        if (fiftyMinuteWarningTimeout) {
            clearTimeout(fiftyMinuteWarningTimeout);
            fiftyMinuteWarningTimeout = null;
        }
        if (fiftyFiveMinuteHangupTimeout) {
            clearTimeout(fiftyFiveMinuteHangupTimeout);
            fiftyFiveMinuteHangupTimeout = null;
        }
        responseActive = false;
        responsePending = false;
        responseQueue.length = 0;
        responseQueueSet.clear();
        pendingTransfer = null;
        pendingTransferResponseReceived = false;
        pendingTransferAudioStarted = false;
        pendingTransferInFlight = false;
        pendingTransferAnnouncementRequested = false;
        pendingTransferAnnouncementResponseId = null;
        pendingTransferAnnouncementAudioStartedAt = 0;
        if (pendingTransferTimeout) {
            clearTimeout(pendingTransferTimeout);
            pendingTransferTimeout = null;
        }
        // Clear any queued messages on close
        assistantSession.clearPendingMessages?.();
        stopWaitingMusic('disconnect');
        clearWaitingMusicInterval();
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
    'session.updated',
];
