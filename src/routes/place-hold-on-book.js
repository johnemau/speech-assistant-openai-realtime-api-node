import { PLACE_HOLD_ON_BOOK_INSTRUCTIONS } from '../assistant/prompts.js';
import {
    verifySignature,
    createSkyvernWebhookHandler,
} from '../utils/skyvern-webhook.js';

export { verifySignature };

const { handler: placeHoldOnBookHandler } = createSkyvernWebhookHandler({
    routeName: 'place-hold-on-book',
    eventPrefix: 'place_hold_on_book',
    noDataError: 'No hold data in payload.',
    llmFailError: 'Failed to compose hold message.',
    instructions: PLACE_HOLD_ON_BOOK_INSTRUCTIONS,
    buildInput: (content) => `Hold result:\n${content}`,
    withPageCall: false,
});

export { placeHoldOnBookHandler };
