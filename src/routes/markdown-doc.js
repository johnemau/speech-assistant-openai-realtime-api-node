import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';

// Tagged template for HTML authoring with editor tooling support.
const html = String.raw;

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
            const renderedHtml = html`<!doctype html>
                <html lang="en">
                    <head>
                        <meta charset="utf-8" />
                        <meta
                            name="viewport"
                            content="width=device-width, initial-scale=1"
                        />
                        <meta name="color-scheme" content="light dark" />
                        <title>${pageTitle}</title>
                        <style>
                            :root {
                                color-scheme: light dark;
                                --bg: #ffffff;
                                --text: #1f2937;
                                --muted: #4b5563;
                                --link: #0a5bc4;
                                --border: #e5e7eb;
                            }
                            @media (prefers-color-scheme: dark) {
                                :root {
                                    --bg: #0f172a;
                                    --text: #e5e7eb;
                                    --muted: #cbd5e1;
                                    --link: #7dd3fc;
                                    --border: #334155;
                                }
                            }
                            * {
                                box-sizing: border-box;
                            }
                            body {
                                margin: 0 auto;
                                max-width: 78ch;
                                padding: 2rem 1.25rem 3rem;
                                background: var(--bg);
                                color: var(--text);
                                font:
                                    16px/1.6 ui-sans-serif,
                                    system-ui,
                                    -apple-system,
                                    Segoe UI,
                                    sans-serif;
                            }
                            a {
                                color: var(--link);
                            }
                            p,
                            li {
                                color: var(--muted);
                            }
                            hr {
                                border: 0;
                                border-top: 1px solid var(--border);
                            }
                            img {
                                max-width: 100%;
                                height: auto;
                            }
                            pre,
                            code {
                                font-family:
                                    ui-monospace, SFMono-Regular, Menlo, Monaco,
                                    Consolas, monospace;
                            }
                        </style>
                    </head>
                    <body>
                        ${renderedBody}
                    </body>
                </html>`;

            reply.type('text/html; charset=utf-8').send(renderedHtml);
        } catch {
            reply
                .code(500)
                .type('text/plain; charset=utf-8')
                .send('Unable to load markdown document.');
        }
    };
}
