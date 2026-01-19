import dotenv from 'dotenv';
import { createAssistantSession, safeParseToolArguments } from '../src/assistant/session.js';
import { getToolDefinitions, executeToolCall } from '../src/tools/index.js';
import { judgeResponse } from '../src/testing/judge.js';
import { SYSTEM_MESSAGE, WEB_SEARCH_INSTRUCTIONS } from '../src/assistant/prompts.js';
import { callerTurns, expectedAssistant } from '../tests/voice-tests.js';
import { isTruthy } from '../src/utils/env.js';
import { normalizeUSNumberToE164 } from '../src/utils/phone.js';
import { createOpenAIClient, createTwilioClient, createEmailTransport } from '../src/utils/clients.js';

dotenv.config();

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY.');
    process.exit(1);
}

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

const allowLiveSideEffects = isTruthy(process.env.ALLOW_LIVE_SIDE_EFFECTS);
const passScoreThreshold = Number(process.env.JUDGE_PASS_SCORE || 0.7);
const judgeModel = process.env.JUDGE_MODEL || 'gpt-5.2';

const primarySet = new Set(
    (process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
);
const secondarySet = new Set(
    (process.env.SECONDARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
);

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
                    openaiClient,
                    twilioClient,
                    senderTransport,
                    env: process.env,
                    normalizeUSNumberToE164,
                    primaryCallersSet: primarySet,
                    secondaryCallersSet: secondarySet,
                    currentCallerE164,
                    currentTwilioNumberE164,
                    webSearchInstructions: WEB_SEARCH_INSTRUCTIONS,
                    defaultUserLocation: { type: 'approximate', country: 'US', region: 'Washington' },
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

(async () => {
    if (callerTurns.length !== expectedAssistant.length) {
        console.error('callerTurns and expectedAssistant length mismatch.');
        process.exit(1);
    }

    const results = [];
    for (let i = 0; i < callerTurns.length; i += 1) {
        const callerTurn = callerTurns[i];
        const expectation = expectedAssistant[i];
        try {
            const { assistantText, toolError } = await runTurn({ callerTurn, index: i });
            const judge = await judgeResponse({
                openaiClient,
                callerTurn,
                assistantText,
                expectation,
                model: judgeModel,
            });
            const score = Number(judge?.score || 0);
            const pass = Boolean(judge?.pass) && score >= passScoreThreshold && !toolError;
            results.push({ callerTurn, expectation, assistantText, judge, pass, toolError });
        } catch (error) {
            results.push({ callerTurn, expectation, assistantText: '', judge: null, pass: false, toolError: error?.message || String(error) });
        }
    }

    const failed = results.filter((r) => !r.pass);
    for (const [idx, res] of results.entries()) {
        const status = res.pass ? 'PASS' : 'FAIL';
        console.log(`Turn ${idx + 1}: ${status}`);
        if (!res.pass) {
            if (res.toolError) console.log(`  Tool error: ${res.toolError}`);
            if (res.judge?.rationale) console.log(`  Rationale: ${res.judge.rationale}`);
        }
    }

    if (failed.length > 0) {
        console.error(`\n${failed.length} turn(s) failed.`);
        process.exit(1);
    }

    console.log('\nAll voice test turns passed.');
    process.exit(0);
})();
