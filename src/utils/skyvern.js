import { IS_DEV } from '../env.js';
import { logHttpRequest, logHttpResponse } from './http-log.js';

const SKYVERN_API_BASE = 'https://api.skyvern.com';

/**
 * @typedef {object} RunWorkflowArgs
 * @property {string} workflowId - Skyvern workflow permanent ID (e.g. "wpid_...").
 * @property {Record<string, string>} parameters - Input parameters matching the workflow definition.
 * @property {string} [webhook_url] - Optional URL Skyvern will POST results to when the workflow completes.
 */

/**
 * Fire-and-forget: start a Skyvern workflow run and return the API response.
 *
 * Reads `SKYVERN_API_KEY` from the environment at call time. Throws if the key
 * is missing or if the Skyvern API returns a non-2xx status.
 *
 * @param {RunWorkflowArgs} args - Workflow invocation arguments.
 * @returns {Promise<unknown>} Parsed JSON response from the Skyvern API.
 */
export async function runWorkflow({ workflowId, parameters, webhook_url }) {
    const apiKey = process.env.SKYVERN_API_KEY;
    if (!apiKey) {
        throw new Error('SKYVERN_API_KEY not set');
    }

    const url = `${SKYVERN_API_BASE}/v1/run/workflows`;
    const body = {
        workflow_id: workflowId,
        parameters,
        proxy_location: 'RESIDENTIAL',
        max_screenshot_scrolls: 10,
        ...(webhook_url ? { webhook_url } : {}),
    };

    if (IS_DEV) {
        console.log('skyvern: runWorkflow request', {
            event: 'skyvern.run_workflow.request',
            url,
            workflow_id: workflowId,
            parameters,
            webhook_url,
        });
        logHttpRequest({ tag: 'skyvern', url, method: 'POST', body });
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        if (IS_DEV) {
            console.log('skyvern: runWorkflow error response', {
                event: 'skyvern.run_workflow.error',
                status: response.status,
                statusText: response.statusText,
            });
        }
        throw new Error(`Skyvern API error: ${response.status}`);
    }

    const result = await response.json();

    if (IS_DEV) {
        logHttpResponse({
            tag: 'skyvern',
            url,
            status: response.status,
            statusText: response.statusText,
            body: result,
        });
        console.log('skyvern: runWorkflow response', {
            event: 'skyvern.run_workflow.response',
            status: response.status,
            result,
        });
    }

    return result;
}
