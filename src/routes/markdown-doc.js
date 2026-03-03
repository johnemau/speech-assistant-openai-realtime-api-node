import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';

/**
 * @param {string} value - Raw title value.
 * @returns {string} Escaped HTML-safe title.
 */
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * @param {object} root0 - Markdown route options.
 * @param {string} root0.filePath - Absolute or workspace-relative markdown path.
 * @param {string} [root0.title] - Optional document title.
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>} Fastify handler.
 */
export function createMarkdownDocHandler({ filePath, title }) {
    return async function markdownDocHandler(_request, reply) {
        const configuredPath = String(filePath || '').trim();

        if (!configuredPath) {
            reply
                .code(500)
                .type('text/plain; charset=utf-8')
                .send('Markdown file path is not configured.');
            return;
        }

        const absolutePath = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(process.cwd(), configuredPath);

        try {
            const markdown = await readFile(absolutePath, 'utf8');
            const renderedBody = marked.parse(markdown);
            const pageTitle = escapeHtml(title || path.basename(absolutePath));
            const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${pageTitle}</title>\n</head>\n<body>\n${renderedBody}\n</body>\n</html>`;

            reply.type('text/html; charset=utf-8').send(html);
        } catch {
            reply
                .code(500)
                .type('text/plain; charset=utf-8')
                .send('Unable to load markdown document.');
        }
    };
}
