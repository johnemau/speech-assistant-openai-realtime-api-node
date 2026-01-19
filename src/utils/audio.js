import fs from 'fs';

// Convert 16-bit PCM linear sample to 8-bit mu-law (PCMU)
function linearToMuLaw(s16) {
    const CLIP = 32635;
    const BIAS = 0x84; // 132
    let sign = 0;
    if (s16 < 0) {
        sign = 0x80;
        s16 = -s16;
    }
    if (s16 > CLIP) s16 = CLIP;
    s16 = s16 + BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (s16 & expMask) === 0 && exponent > 0; expMask >>= 1) {
        exponent--;
    }
    const mantissa = (s16 >> (exponent + 3)) & 0x0F;
    let mu = ~(sign | (exponent << 4) | mantissa);
    return mu & 0xFF;
}

// Parse a WAV file and convert to µ-law (PCMU) 8kHz mono bytes
export function parseWavToUlaw(filePath, volume = 0.12) {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 44) throw new Error('WAV file too small');
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Not a RIFF/WAVE file');
    }
    let pos = 12;
    let audioFormat = null;
    let numChannels = null;
    let sampleRate = null;
    let bitsPerSample = null;
    let dataOffset = null;
    let dataSize = null;
    while (pos + 8 <= buf.length) {
        const chunkId = buf.toString('ascii', pos, pos + 4);
        const chunkSize = buf.readUInt32LE(pos + 4);
        if (chunkId === 'fmt ') {
            audioFormat = buf.readUInt16LE(pos + 8);
            numChannels = buf.readUInt16LE(pos + 10);
            sampleRate = buf.readUInt32LE(pos + 12);
            bitsPerSample = buf.readUInt16LE(pos + 22);
        } else if (chunkId === 'data') {
            dataOffset = pos + 8;
            dataSize = chunkSize;
        }
        pos += 8 + chunkSize;
    }
    if (audioFormat !== 1) throw new Error('WAV must be PCM');
    if (bitsPerSample !== 16) throw new Error('WAV must be 16-bit');
    if (!dataOffset || !dataSize) throw new Error('WAV data chunk not found');
    const bytesPerSample = 2; // 16-bit PCM
    const frames = Math.floor(dataSize / (bytesPerSample * numChannels));
    const monoSamples = new Int16Array(frames);
    // Downmix to mono
    for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let ch = 0; ch < numChannels; ch++) {
            const off = dataOffset + (i * numChannels + ch) * 2;
            const s = buf.readInt16LE(off);
            sum += s;
        }
        const avg = Math.max(-32768, Math.min(32767, Math.floor(sum / numChannels)));
        monoSamples[i] = avg;
    }
    // Resample to 8000 Hz using linear interpolation
    const srcRate = sampleRate;
    const dstRate = 8000;
    const ratio = dstRate / srcRate;
    const outLen = Math.max(1, Math.floor(monoSamples.length * ratio));
    const ulawBytes = Buffer.alloc(outLen);
    for (let oi = 0; oi < outLen; oi++) {
        const srcIndex = oi / ratio; // map dst->src
        const i0 = Math.floor(srcIndex);
        const frac = srcIndex - i0;
        const s0 = monoSamples[i0] || 0;
        const s1 = monoSamples[i0 + 1] || s0;
        let s = s0 + frac * (s1 - s0);
        // Apply volume scalar
        s = Math.max(-32768, Math.min(32767, Math.floor(s * volume)));
        ulawBytes[oi] = linearToMuLaw(s);
    }
    return ulawBytes;
}
