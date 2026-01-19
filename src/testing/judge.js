/**
 *
 * @param root0
 * @param root0.openaiClient
 * @param root0.callerTurn
 * @param root0.assistantText
 * @param root0.expectation
 * @param root0.model
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
