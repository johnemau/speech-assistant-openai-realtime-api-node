import { runWorkflow as realRunWorkflow } from '../utils/skyvern.js';
import { IS_DEV, getServerBaseUrl } from '../env.js';

/** @type {typeof realRunWorkflow} */
let runWorkflowImpl = realRunWorkflow;

/**
 * Override `runWorkflow` for unit tests.
 *
 * @param {typeof realRunWorkflow | null} [fn] - Replacement implementation, or null to reset.
 */
export function setRunWorkflowForTests(fn) {
    runWorkflowImpl = fn ?? realRunWorkflow;
}

/** Reset `runWorkflow` to the real implementation after tests. */
export function resetRunWorkflowForTests() {
    runWorkflowImpl = realRunWorkflow;
}

export const definition = {
    type: 'function',
    name: 'check_book_holds',
    description:
        'Check the current holds on library books. ' +
        'Triggers an automated browser workflow in the background. ' +
        'You will receive a text message with the results once complete.',
    parameters: {
        type: 'object',
        properties: {},
        required: [],
    },
};

/**
 * @param {object} root0 - Tool invocation.
 * @param {object} root0.args - Tool arguments.
 * @returns {Promise<object>} Tool result.
 */
export async function execute({ args: _args }) {
    const workflowId = process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID;
    if (!workflowId) {
        if (IS_DEV) {
            console.log(
                'check-book-holds: SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID not set',
                {
                    event: 'check_book_holds.misconfigured',
                }
            );
        }
        return { error: 'Check book holds workflow not configured.' };
    }

    if (IS_DEV) {
        console.log('check-book-holds: execute', {
            event: 'check_book_holds.execute',
            workflow_id: workflowId,
        });
    }

    try {
        const webhookUrl = `${getServerBaseUrl()}/check-book-holds`;
        await runWorkflowImpl({
            workflowId,
            parameters: {},
            webhook_url: webhookUrl,
        });

        if (IS_DEV) {
            console.log('check-book-holds: workflow started', {
                event: 'check_book_holds.started',
            });
        }

        return {
            status: 'started',
            message:
                "I'm checking your holds in the background. " +
                "You'll receive a text message once it's complete.",
        };
    } catch (e) {
        const detail = e?.message || String(e);
        if (IS_DEV) {
            console.log('check-book-holds: workflow error', {
                event: 'check_book_holds.error',
                error: detail,
            });
        }
        return {
            error: `Failed to start check book holds workflow: ${detail}`,
        };
    }
}
