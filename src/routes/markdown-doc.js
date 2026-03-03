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
            const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<title>${pageTitle}</title>\n<style>\n:root {\n  color-scheme: light dark;\n  --bg: #ffffff;\n  --text: #1f2937;\n  --muted: #4b5563;\n  --link: #0a5bc4;\n  --border: #e5e7eb;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n    --bg: #0f172a;\n    --text: #e5e7eb;\n    --muted: #cbd5e1;\n    --link: #7dd3fc;\n    --border: #334155;\n  }\n}\n* { box-sizing: border-box; }\nbody {\n  margin: 0 auto;\n  max-width: 78ch;\n  padding: 2rem 1.25rem 3rem;\n  background: var(--bg);\n  color: var(--text);\n  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;\n}\na { color: var(--link); }\np, li { color: var(--muted); }\nhr { border: 0; border-top: 1px solid var(--border); }\nimg { max-width: 100%; height: auto; }\npre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }\n</style>\n</head>\n<body>\n${renderedBody}\n</body>\n</html>`;

            reply.type('text/html; charset=utf-8').send(html);
        } catch {
            reply
                .code(500)
                .type('text/plain; charset=utf-8')
                .send('Unable to load markdown document.');
        }
    };
}
