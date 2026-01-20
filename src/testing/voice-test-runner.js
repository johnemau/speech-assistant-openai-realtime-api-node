import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createAssistantSession, safeParseToolArguments } from '../assistant/session.js';
import { getToolDefinitions, executeToolCall } from '../tools/index.js';
import { judgeResponse } from './judge.js';
import { SYSTEM_MESSAGE } from '../assistant/prompts.js';
import { isTruthy } from '../utils/env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { createOpenAIClient, createTwilioClient, createEmailTransport } from '../utils/clients.js';

dotenv.config();

const { OPENAI_API_KEY } = process.env;
assert.ok(OPENAI_API_KEY, 'Missing OPENAI_API_KEY.');

const openaiClient = createOpenAIClient({ apiKey: OPENAI_API_KEY });

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY, TWILIO_API_SECRET } = process.env;
const twilioClient = createTwilioClient({
    accountSid: TWILIO_ACCOUNT_SID,
    authToken: TWILIO_AUTH_TOKEN,
    apiKey: TWILIO_API_KEY,
    apiSecret: TWILIO_API_SECRET,
    logger: console
});

const senderTransport = createEmailTransport({
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    serviceId: process.env.SMTP_NODEMAILER_SERVICE_ID,
    logger: console
});
const init = await import('../init.js');
init.setInitClients({ openaiClient, twilioClient, senderTransport });

const allowLiveSideEffects = isTruthy(process.env.ALLOW_LIVE_SIDE_EFFECTS);
const passScoreThreshold = Number(process.env.JUDGE_PASS_SCORE || 0.7);
const judgeModel = process.env.JUDGE_MODEL || 'gpt-5.2';

const fallbackCaller = (process.env.PRIMARY_USER_PHONE_NUMBERS || '').split(',')[0];
const currentCallerE164 = normalizeUSNumberToE164(process.env.TEST_CALLER_NUMBER || fallbackCaller || '');
const currentTwilioNumberE164 = normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER || '');

const micState = {
    currentNoiseReductionType: 'near_field',
    lastMicDistanceToggleTs: 0,
    farToggles: 0,
    nearToggles: 0,
    skippedNoOp: 0,
};

let currentTurnResolve = null;
let currentTurnText = '';
let currentTurnHasToolError = null;

const assistantSession = createAssistantSession({
    apiKey: OPENAI_API_KEY,
    model: 'gpt-realtime',
    temperature: 0.4,
    instructions: SYSTEM_MESSAGE,
    tools: getToolDefinitions(),
    outputModalities: ['text'],
    onEvent: (event) => {
        if (event.type === 'response.done') {
            const functionCall = event.response?.output?.[0];
            if (!functionCall || functionCall?.type !== 'function_call') {
                const resolvedText = currentTurnText.trim();
                currentTurnResolve?.({
                    assistantText: resolvedText,
                    toolError: currentTurnHasToolError,
                });
                currentTurnResolve = null;
                currentTurnText = '';
                currentTurnHasToolError = null;
            }
        }
    },
    onAssistantOutput: (payload) => {
        if (payload?.type === 'text' && typeof payload.delta === 'string') {
            currentTurnText += payload.delta;
        }
        if (payload?.type === 'text_done' && typeof payload.text === 'string') {
            currentTurnText += payload.text;
        }
    },
    onToolCall: async (functionCall) => {
        try {
            const toolInput = safeParseToolArguments(functionCall.arguments);
            const output = await executeToolCall({
                name: functionCall.name,
                args: toolInput,
                context: {
                    currentCallerE164,
                    currentTwilioNumberE164,
                    micState,
                    applyNoiseReduction: (mode) => {
                        micState.currentNoiseReductionType = mode;
                    },
                    allowLiveSideEffects,
                }
            });

            const toolResultEvent = {
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: functionCall.call_id,
                    output: JSON.stringify(output)
                }
            };
            assistantSession.send(toolResultEvent);
            assistantSession.requestResponse();
        } catch (error) {
            currentTurnHasToolError = error?.message || String(error);
            const toolErrorEvent = {
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: functionCall.call_id,
                    output: JSON.stringify({ error: currentTurnHasToolError })
                }
            };
            assistantSession.send(toolErrorEvent);
            assistantSession.requestResponse();
        }
    }
});

async function runTurn({ callerTurn, index, timeoutMs = 90000 }) {
    currentTurnText = '';
    currentTurnHasToolError = null;

    const turnPromise = new Promise((resolve) => {
        currentTurnResolve = resolve;
    });

    assistantSession.send({
        type: 'conversation.item.create',
        item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: callerTurn }]
        }
    });
    assistantSession.requestResponse();

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Turn ${index + 1} timed out after ${timeoutMs}ms.`)), timeoutMs);
    });

    return Promise.race([turnPromise, timeoutPromise]);
}

function formatFailureSummary(failedResults = []) {
    if (!failedResults.length) return 'All voice test turns passed.';
    const lines = failedResults.map((res) => {
        const turnNumber = Number.isFinite(res.turnIndex) ? res.turnIndex + 1 : '?';
        const toolLine = res.toolError ? ` Tool error: ${res.toolError}` : '';
        const rationale = res.judge?.rationale ? ` Rationale: ${res.judge.rationale}` : '';
        return `Turn ${turnNumber}: FAIL.${toolLine}${rationale}`.trim();
    });
    return `${failedResults.length} turn(s) failed.\n${lines.join('\n')}`;
}

/**
 * Run a series of voice test turns and return results.
 *
 * @param {object} root0 - Test inputs.
 * @param {string[]} [root0.callerTurns] - Caller utterances.
 * @param {string[]} [root0.expectedAssistant] - Expected assistant behavior per turn.
 * @param {number} [root0.timeoutMs] - Timeout per turn in milliseconds.
 * @returns {Promise<Array<{
 *   turnIndex: number,
 *   callerTurn: string,
 *   expectation: string,
 *   assistantText: string,
 *   judge: object | null,
 *   pass: boolean,
 *   toolError?: string,
 * }>>} Results for each turn.
 */
export async function runVoiceTests({ callerTurns = [], expectedAssistant = [], timeoutMs = 90000 } = {}) {
    assert.equal(
        callerTurns.length,
        expectedAssistant.length,
        'callerTurns and expectedAssistant length mismatch.'
    );

    const results = [];
    for (let i = 0; i < callerTurns.length; i += 1) {
        const callerTurn = callerTurns[i];
        const expectation = expectedAssistant[i];
        try {
            const { assistantText, toolError } = await runTurn({ callerTurn, index: i, timeoutMs });
            const judge = await judgeResponse({
                openaiClient,
                callerTurn,
                assistantText,
                expectation,
                model: judgeModel,
            });
            const score = Number(judge?.score || 0);
            const pass = Boolean(judge?.pass) && score >= passScoreThreshold && !toolError;
            results.push({
                turnIndex: i,
                callerTurn,
                expectation,
                assistantText,
                judge,
                pass,
                toolError
            });
        } catch (error) {
            results.push({
                turnIndex: i,
                callerTurn,
                expectation,
                assistantText: '',
                judge: null,
                pass: false,
                toolError: error?.message || String(error)
            });
        }
    }

    const failed = results.filter((r) => !r.pass);
    assert.equal(failed.length, 0, formatFailureSummary(failed));
    return results;
}
