import { CHECK_BOOK_HOLDS_INSTRUCTIONS } from '../assistant/prompts.js';
import {
    verifySignature,
    createSkyvernWebhookHandler,
} from '../utils/skyvern-webhook.js';

export { verifySignature };

const { handler: checkBookHoldsHandler } = createSkyvernWebhookHandler({
    routeName: 'check-book-holds',
    eventPrefix: 'check_book_holds',
    noDataError: 'No holds data in payload.',
    llmFailError: 'Failed to compose holds message.',
    instructions: CHECK_BOOK_HOLDS_INSTRUCTIONS,
    buildInput: (content) => `Current holds:\n${content}`,
    withPageCall: false,
});

export { checkBookHoldsHandler };
