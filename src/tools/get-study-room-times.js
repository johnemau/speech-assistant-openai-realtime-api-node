import { runWorkflow as realRunWorkflow } from '../utils/skyvern.js';
import { IS_DEV } from '../env.js';

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
    name: 'get_study_room_times',
    description:
        'Check study room availability at a library for a target date. ' +
        'Triggers an automated browser workflow in the background. ' +
        'The caller will receive a call and text message with the results once the check is complete.',
    parameters: {
        type: 'object',
        properties: {
            library_location: {
                type: 'string',
                description:
                    'Name or address of the library to check, e.g. "Bellevue Library".',
            },
            target_date: {
                type: 'string',
                description:
                    'Target date to check availability for, e.g. "April 10, 2026".',
            },
        },
        required: ['library_location', 'target_date'],
    },
};

/**
 * @param {object} root0 - Tool invocation.
 * @param {{ library_location?: unknown, target_date?: unknown }} root0.args - Tool arguments.
 * @returns {Promise<object>} Tool result.
 */
export async function execute({ args }) {
    const workflowId = process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID;
    if (!workflowId) {
        if (IS_DEV) {
            console.log(
                'get-study-room-times: SKYVERN_STUDY_ROOM_WORKFLOW_ID not set',
                {
                    event: 'get_study_room_times.misconfigured',
                }
            );
        }
        return { error: 'Study room workflow not configured.' };
    }

    const libraryLocation = String(args?.library_location ?? '').trim();
    const targetDate = String(args?.target_date ?? '').trim();

    if (IS_DEV) {
        console.log('get-study-room-times: execute', {
            event: 'get_study_room_times.execute',
            library_location: libraryLocation,
            target_date: targetDate,
            workflow_id: workflowId,
        });
    }

    try {
        await runWorkflowImpl({
            workflowId,
            parameters: {
                library_location: libraryLocation,
                target_date: targetDate,
            },
        });

        if (IS_DEV) {
            console.log('get-study-room-times: workflow started', {
                event: 'get_study_room_times.started',
                library_location: libraryLocation,
                target_date: targetDate,
            });
        }

        return {
            status: 'started',
            message:
                "I'm looking up library study room times in the background. " +
                "You'll receive a call and text once it's complete.",
        };
    } catch (err) {
        if (IS_DEV) {
            console.log('get-study-room-times: workflow start failed', {
                event: 'get_study_room_times.error',
                error: String(err),
            });
        }
        return { error: 'Failed to start study room check.' };
    }
}
