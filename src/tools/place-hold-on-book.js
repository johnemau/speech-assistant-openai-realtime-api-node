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
    name: 'place_hold_on_book',
    description:
        'Place a hold on a library book by title. ' +
        'Triggers an automated browser workflow in the background. ' +
        'You will receive a text message with the result once complete.',
    parameters: {
        type: 'object',
        properties: {
            book_title: {
                type: 'string',
                description:
                    'Title of the book to place a hold on, e.g. "The Pragmatic Programmer".',
            },
        },
        required: ['book_title'],
    },
};

/**
 * @param {object} root0 - Tool invocation.
 * @param {{ book_title?: unknown }} root0.args - Tool arguments.
 * @returns {Promise<object>} Tool result.
 */
export async function execute({ args }) {
    const workflowId = process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID;
    if (!workflowId) {
        if (IS_DEV) {
            console.log(
                'place-hold-on-book: SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID not set',
                {
                    event: 'place_hold_on_book.misconfigured',
                }
            );
        }
        return { error: 'Place hold on book workflow not configured.' };
    }

    const bookTitle = String(args?.book_title ?? '').trim();

    if (IS_DEV) {
        console.log('place-hold-on-book: execute', {
            event: 'place_hold_on_book.execute',
            book_title: bookTitle,
            workflow_id: workflowId,
        });
    }

    try {
        const webhookUrl = `${getServerBaseUrl()}/place-hold-on-book`;
        await runWorkflowImpl({
            workflowId,
            parameters: {
                book_title: bookTitle,
            },
            webhook_url: webhookUrl,
        });

        if (IS_DEV) {
            console.log('place-hold-on-book: workflow started', {
                event: 'place_hold_on_book.started',
                book_title: bookTitle,
            });
        }

        return {
            status: 'started',
            message:
                "I'm placing the hold on the book in the background. " +
                "You'll receive a text message once it's complete.",
        };
    } catch (e) {
        const detail = e?.message || String(e);
        if (IS_DEV) {
            console.log('place-hold-on-book: workflow error', {
                event: 'place_hold_on_book.error',
                error: detail,
            });
        }
        return {
            error: `Failed to start place hold on book workflow: ${detail}`,
        };
    }
}
