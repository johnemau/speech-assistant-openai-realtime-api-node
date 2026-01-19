#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
const ffmpegArgs = [
    '-hide_banner',
    '-y',
    '-i',
    inputPath,
    '-af',
    'aresample=resampler=soxr:precision=28:dither_method=triangular',
    '-ac',
    '1',
    '-ar',
    '8000',
    '-c:a',
    codec,
    outputPath,
];

const result = spawnSync('ffmpeg', ffmpegArgs, { stdio: 'inherit' });
if (result.error) {
    console.error(`Failed to run ffmpeg: ${result.error.message}`);
    process.exit(1);
}
if (result.status !== 0) {
    console.error(`ffmpeg exited with code ${result.status}`);
    process.exit(result.status ?? 1);
}

console.log(`Converted ${inputPath} -> ${outputPath} (${format})`);
