#!/usr/bin/env node
import ffmpeg from 'ffmpeg';
import minimist from 'minimist';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ log: (...args: any[]) => void, error: (...args: any[]) => void }} Logger
 */

/**
 * @param {Logger} logger
 */
export function printUsage(logger = console) {
    logger.log('Usage: npm run convert:wav -- [--dir=/music]');
    logger.log(
        'Converts all .wav files (excluding .mulaw.wav) in the directory to .mulaw.wav.'
    );
    logger.log('Default directory: /music');
    logger.log('Options: --format=mulaw (default: mulaw)');
}

/**
 * @param {string[]} rawArgs
 * @returns {{ format: string, dir: string }}
 */
export function parseArgs(rawArgs) {
    const parsed = minimist(rawArgs, {
        string: ['format', 'dir'],
        default: { format: 'mulaw', dir: '/music' },
        alias: { format: 'f', dir: 'd' },
    });
    const { format, dir } = parsed;
    return { format, dir };
}

/**
 * @param {string} format
 * @returns {boolean}
 */
export function isSupportedFormat(format) {
    return format === 'mulaw';
}

/**
 * @param {string} format
 * @returns {string}
 */
export function getCodecForFormat(format) {
    return 'pcm_mulaw';
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
export function isConvertibleWav(filename) {
    const lower = filename.toLowerCase();
    return lower.endsWith('.wav') && !lower.endsWith('.mulaw.wav');
}

/**
 * @param {{
 *  ffmpegModule: new (input: string) => Promise<any> | any,
 *  inputPath: string,
 *  outputPath: string,
 *  codec: string,
 * }} params
 * @returns {Promise<unknown>}
 */
export async function convertWithFfmpeg({
    ffmpegModule,
    inputPath,
    outputPath,
    codec,
}) {
    let ffmpegProcess;
    try {
        ffmpegProcess = new ffmpegModule(inputPath);
    } catch (error) {
        throw new Error(
            `Failed to initialize ffmpeg for ${inputPath}: ${
                error?.message || String(error)
            }`
        );
    }
    /** @type {any} */
    const video = await ffmpegProcess;
    if (!video) {
        throw new Error(
            `ffmpeg did not return a valid processor for ${inputPath}. ` +
                'Ensure ffmpeg is installed and the input file is a valid media file.'
        );
    }
    const requiredMethods = [
        'setAudioChannels',
        'setAudioFrequency',
        'addCommand',
        'save',
    ];
    for (const method of requiredMethods) {
        if (typeof video[method] !== 'function') {
            throw new Error(
                `ffmpeg processor is missing ${method}(). ` +
                    'Please ensure the ffmpeg module is installed and compatible.'
            );
        }
    }
    return new Promise((resolvePromise, rejectPromise) => {
        video.setAudioChannels(1);
        video.setAudioFrequency(8000);
        video.addCommand('-c:a', codec);
        video.addCommand(
            '-af',
            'aresample=resampler=soxr:precision=28:dither_method=triangular'
        );
        video.save(
            outputPath,
            /** @type {(error: Error | null, file: string) => void} */
            (
                (error, file) => {
                    if (error) {
                        rejectPromise(error);
                        return;
                    }
                    resolvePromise(file);
                }
            )
        );
    });
}

/**
 * @param {{
 *  argv?: string[],
 *  logger?: Logger,
 *  exit?: (code?: number) => void,
 *  existsSyncFn?: (path: import('node:fs').PathLike) => boolean,
 *  readdirSyncFn?: typeof readdirSync,
 *  statSyncFn?: typeof statSync,
 *  resolvePath?: (...paths: string[]) => string,
 *  ffmpegModule?: any
 * }=} options
 */
export async function run({
    argv = process.argv,
    logger = console,
    exit = process.exit,
    existsSyncFn = existsSync,
    readdirSyncFn = readdirSync,
    statSyncFn = statSync,
    resolvePath = resolve,
    ffmpegModule = ffmpeg,
} = {}) {
    const rawArgs = argv.slice(2);
    const { format, dir } = parseArgs(rawArgs);

    if (!isSupportedFormat(format)) {
        logger.error(`Unsupported format: ${format}`);
        printUsage(logger);
        exit(1);
        return;
    }

    const codec = getCodecForFormat(format);

    const targetDir = resolvePath(dir || 'music');
    if (!existsSyncFn(targetDir)) {
        logger.error(`Directory not found: ${targetDir}`);
        exit(1);
        return;
    }

    if (!statSyncFn(targetDir).isDirectory()) {
        logger.error(`Not a directory: ${targetDir}`);
        exit(1);
        return;
    }

    const entries = readdirSyncFn(targetDir, { withFileTypes: true });
    const wavFiles = entries
        .filter((entry) => entry.isFile() && isConvertibleWav(entry.name))
        .map((entry) => join(targetDir, entry.name));

    if (wavFiles.length === 0) {
        logger.log(`No .wav files to convert in ${targetDir}`);
        return;
    }

    for (const inputPath of wavFiles) {
        const outputPath = inputPath.replace(/\.wav$/i, '.mulaw.wav');
        try {
            await convertWithFfmpeg({
                ffmpegModule,
                inputPath,
                outputPath,
                codec,
            });
            logger.log(`Converted ${inputPath} -> ${outputPath} (${format})`);
        } catch (error) {
            logger.error(
                `Failed to run ffmpeg: ${error?.message || JSON.stringify(error)}`
            );
            exit(1);
            return;
        }
    }
}

const isCli = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    await run();
}
