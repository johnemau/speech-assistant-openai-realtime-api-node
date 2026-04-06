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
    name: 'reserve_study_room',
    description:
        'Reserve a study room at a library for a specific date and time range. ' +
        'Triggers an automated browser workflow in the background. ' +
        'The caller will receive a call and text message with the reservation result once complete.',
    parameters: {
        type: 'object',
        properties: {
            library_location: {
                type: 'string',
                description:
                    'Name or address of the library, e.g. "Bellevue Library".',
            },
            room_name: {
                type: 'string',
                description:
                    'Name or identifier of the study room to reserve, e.g. "Room A" or "Study Room 3".',
            },
            target_date: {
                type: 'string',
                description: 'Date of the reservation, e.g. "April 10, 2026".',
            },
            start_time: {
                type: 'string',
                description: 'Start time of the reservation, e.g. "2:00 PM".',
            },
            end_time: {
                type: 'string',
                description: 'End time of the reservation, e.g. "4:00 PM".',
            },
        },
        required: [
            'library_location',
            'room_name',
            'target_date',
            'start_time',
            'end_time',
        ],
    },
};

/**
 * @param {object} root0 - Tool invocation.
 * @param {{ library_location?: unknown, room_name?: unknown, target_date?: unknown, start_time?: unknown, end_time?: unknown }} root0.args - Tool arguments.
 * @returns {Promise<object>} Tool result.
 */
export async function execute({ args }) {
    const workflowId = process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID;
    if (!workflowId) {
        if (IS_DEV) {
            console.log(
                'reserve-study-room: SKYVERN_RESERVE_ROOM_WORKFLOW_ID not set',
                {
                    event: 'reserve_study_room.misconfigured',
                }
            );
        }
        return { error: 'Reserve study room workflow not configured.' };
    }

    const libraryLocation = String(args?.library_location ?? '').trim();
    const roomName = String(args?.room_name ?? '').trim();
    const targetDate = String(args?.target_date ?? '').trim();
    const startTime = String(args?.start_time ?? '').trim();
    const endTime = String(args?.end_time ?? '').trim();

    if (IS_DEV) {
        console.log('reserve-study-room: execute', {
            event: 'reserve_study_room.execute',
            library_location: libraryLocation,
            room_name: roomName,
            target_date: targetDate,
            start_time: startTime,
            end_time: endTime,
            workflow_id: workflowId,
        });
    }

    try {
        const webhookUrl = `${getServerBaseUrl()}/reserve-study-room`;
        await runWorkflowImpl({
            workflowId,
            parameters: {
                library_location: libraryLocation,
                room_name: roomName,
                target_date: targetDate,
                start_time: startTime,
                end_time: endTime,
            },
            webhook_url: webhookUrl,
        });

        if (IS_DEV) {
            console.log('reserve-study-room: workflow started', {
                event: 'reserve_study_room.started',
                library_location: libraryLocation,
                room_name: roomName,
                target_date: targetDate,
                start_time: startTime,
                end_time: endTime,
            });
        }

        return {
            status: 'started',
            message:
                "I'm reserving the study room in the background. " +
                "You'll receive a call and text once it's complete.",
        };
    } catch (err) {
        if (IS_DEV) {
            console.log('reserve-study-room: workflow start failed', {
                event: 'reserve_study_room.error',
                error: String(err),
            });
        }
        return { error: 'Failed to start study room reservation.' };
    }
}
