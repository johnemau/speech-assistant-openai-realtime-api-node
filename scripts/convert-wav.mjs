#!/usr/bin/env node
import ffmpeg from 'ffmpeg';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function printUsage() {
    console.log('Usage: npm run convert:wav -- <input.wav> <output.wav>');
    console.log('Options: --format=mulaw|pcm (default: mulaw)');
}

const rawArgs = process.argv.slice(2);
const formatArg = rawArgs.find((arg) => arg.startsWith('--format='));
const format = formatArg ? formatArg.split('=')[1] : 'mulaw';
const args = rawArgs.filter((arg) => !arg.startsWith('--format='));

if (format !== 'mulaw' && format !== 'pcm') {
    console.error(`Unsupported format: ${format}`);
    printUsage();
    process.exit(1);
}

if (args.length < 2) {
    printUsage();
    process.exit(1);
}

const inputPath = resolve(args[0]);
const outputPath = resolve(args[1]);

if (!existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
}

const codec = format === 'mulaw' ? 'pcm_mulaw' : 'pcm_s16le';

try {
    const ffmpegProcess = new ffmpeg(inputPath);
    const video = await ffmpegProcess;
    await new Promise((resolvePromise, rejectPromise) => {
        video
            .setAudioCodec(codec)
            .setAudioChannels(1)
            .setAudioFrequency(8000)
            .addCommand('-af', 'aresample=resampler=soxr:precision=28:dither_method=triangular')
            .save(outputPath, (error, file) => {
                if (error) {
                    rejectPromise(error);
                    return;
                }
                resolvePromise(file);
            });
    });

    console.log(`Converted ${inputPath} -> ${outputPath} (${format})`);
} catch (error) {
    console.error(`Failed to run ffmpeg: ${error?.message || error}`);
    process.exit(1);
}
