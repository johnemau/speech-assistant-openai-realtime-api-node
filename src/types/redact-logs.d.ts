declare module 'redact-logs' {
    export default function patchLogs(keys?: string[]): () => void;
}
