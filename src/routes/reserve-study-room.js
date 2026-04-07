import { RESERVE_ROOM_INSTRUCTIONS } from '../assistant/prompts.js';
import {
    verifySignature,
    createSkyvernWebhookHandler,
} from '../utils/skyvern-webhook.js';

export { verifySignature };

const { handler: reserveStudyRoomHandler, setDeps: setReserveStudyRoomDeps } =
    createSkyvernWebhookHandler({
        routeName: 'reserve-study-room',
        eventPrefix: 'reserve_study_room',
        noDataError: 'No reservation data in payload.',
        llmFailError: 'Failed to compose reservation message.',
        instructions: RESERVE_ROOM_INSTRUCTIONS,
        buildInput: (content) => `Reservation result:\n${content}`,
        withPageCall: true,
    });

export { reserveStudyRoomHandler, setReserveStudyRoomDeps };
