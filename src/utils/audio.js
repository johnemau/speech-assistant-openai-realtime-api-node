import fs from 'fs';

/**
 * Read a raw µ-law (PCMU) 8kHz mono file into a Buffer.
 *
 * @param {string} filePath - Path to a raw PCMU file.
 * @returns {Buffer} µ-law audio bytes.
 */
export function readPcmuFile(filePath) {
    const buf = fs.readFileSync(filePath);
    if (!buf || buf.length === 0) {
        throw new Error('PCMU file is empty');
    }
    return Buffer.from(buf);
}
