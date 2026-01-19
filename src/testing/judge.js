/**
 * Judge a single assistant response against an expectation.
 *
 * @param {object} root0 - Judge inputs.
 * @param {{ responses: { create: Function } }} root0.openaiClient - OpenAI client.
 * @param {string} root0.callerTurn - Caller text turn.
 * @param {string} root0.assistantText - Assistant text turn.
 * @param {string} root0.expectation - Expected behavior description.
 * @param {string} [root0.model] - Model to use for judging.
 * @returns {Promise<{ pass: boolean, score: number, rationale: string }>} Judgment result.
 */
export async function judgeResponse({ openaiClient, callerTurn, assistantText, expectation, model = 'gpt-5.2' }) {
    const prompt = `You are a strict evaluator for a voice assistant response.\n\nCaller turn:\n${callerTurn}\n\nAssistant response:\n${assistantText}\n\nExpectation:\n${expectation}\n\nReturn JSON only in this exact schema: {"pass":boolean,"score":number,"rationale":string}. Score is 0.0 to 1.0. Pass true only if expectation is fully met.`;

    const result = await openaiClient.responses.create({
        model,
        reasoning: { effort: 'low' },
        input: prompt,
        truncation: 'auto',
    });

    const text = String(result?.output_text || '').trim();
    try {
        return JSON.parse(text);
    } catch {
        return {
            pass: false,
            score: 0,
            rationale: `Judge output was not valid JSON: ${text}`,
        };
    }
}
