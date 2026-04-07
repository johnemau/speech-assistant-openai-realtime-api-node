import { STUDY_ROOM_INSTRUCTIONS } from '../assistant/prompts.js';
import {
    verifySignature,
    createSkyvernWebhookHandler,
} from '../utils/skyvern-webhook.js';

export { verifySignature };

const { handler: studyRoomTimesHandler, setDeps: setStudyRoomTimesDeps } =
    createSkyvernWebhookHandler({
        routeName: 'get-study-room-times',
        eventPrefix: 'study_room_times',
        noDataError: 'No study room data in payload.',
        llmFailError: 'Failed to summarize study room data.',
        instructions: STUDY_ROOM_INSTRUCTIONS,
        buildInput: (content) =>
            `Study room data:\n${content}\n\nList all available time slots through the day for the 3 smallest-capacity rooms that have at least 30 minutes of available time.`,
        withPageCall: true,
    });

export { studyRoomTimesHandler, setStudyRoomTimesDeps };
