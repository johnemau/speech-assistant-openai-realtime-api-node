import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { IS_DEV } from '../env.js';

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
 * @param {Record<string, string>} [root0.variables] - Key/value pairs to substitute in the markdown (e.g. `{{KEY}}` → value).
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>} Fastify handler.
 */
export function createMarkdownDocHandler({ filePath, title, variables }) {
    return async function markdownDocHandler(_request, reply) {
        if (IS_DEV) {
            console.log('markdown-doc: handler invoked', {
                event: 'markdown-doc.handler.start',
                configuredFilePath: filePath,
                configuredTitle: title,
            });
        }

        const configuredPath = String(filePath || '').trim();

        if (!configuredPath) {
            if (IS_DEV) {
                console.log('markdown-doc: missing file path', {
                    event: 'markdown-doc.error.missing_path',
                    configuredPath,
                });
            }
            reply
                .code(500)
                .type('text/plain; charset=utf-8')
                .send('Markdown file path is not configured.');
            return;
        }

        const absolutePath = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(process.cwd(), configuredPath);

        if (IS_DEV) {
            console.log('markdown-doc: resolved file path', {
                event: 'markdown-doc.path.resolved',
                configuredPath,
                absolutePath,
            });
        }

        try {
            const markdown = await readFile(absolutePath, 'utf8');
            if (IS_DEV) {
                console.log('markdown-doc: file read successfully', {
                    event: 'markdown-doc.file.read',
                    filePath: absolutePath,
                    contentLength: markdown.length,
                    contentPreview: markdown.slice(0, 200),
                });
            }

            let processedMarkdown = markdown;
            if (variables) {
                for (const [key, value] of Object.entries(variables)) {
                    processedMarkdown = processedMarkdown.replaceAll(
                        `{{${key}}}`,
                        value
                    );
                }
            }

            const renderedBody = marked.parse(processedMarkdown);
            if (IS_DEV) {
                console.log('markdown-doc: markdown parsed', {
                    event: 'markdown-doc.markdown.parsed',
                    sourceLength: markdown.length,
                    renderedLength: String(renderedBody).length,
                });
            }

            const pageTitle = escapeHtml(title || path.basename(absolutePath));
            if (IS_DEV) {
                console.log('markdown-doc: page title computed', {
                    event: 'markdown-doc.title.computed',
                    pageTitle,
                });
            }
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

            if (IS_DEV) {
                console.log('markdown-doc: html generated successfully', {
                    event: 'markdown-doc.html.generated',
                    htmlLength: String(renderedHtml).length,
                });
            }

            reply.type('text/html; charset=utf-8').send(renderedHtml);

            if (IS_DEV) {
                console.log('markdown-doc: handler completed successfully', {
                    event: 'markdown-doc.handler.success',
                    filePath: absolutePath,
                });
            }
        } catch (err) {
            if (IS_DEV) {
                console.log('markdown-doc: error during processing', {
                    event: 'markdown-doc.error.processing',
                    filePath: absolutePath,
                    errorMessage: err?.message || String(err),
                    errorStack: err?.stack,
                });
            }
            reply
                .code(500)
                .type('text/plain; charset=utf-8')
                .send('Unable to load markdown document.');
        }
    };
}
