#!/usr/bin/env node
import ffmpeg from 'ffmpeg';
import minimist from 'minimist';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ log: (...args: any[]) => void, error: (...args: any[]) => void }} Logger
 */

/**
 * @param {Logger} logger
 */
export function printUsage(logger = console) {
    logger.log('Usage: npm run convert:wav -- <input.wav> <output.wav>');
    logger.log('Options: --format=mulaw|pcm (default: mulaw)');
}

/**
 * @param {string[]} rawArgs
 * @returns {{ format: string, args: string[] }}
 */
export function parseArgs(rawArgs) {
    const parsed = minimist(rawArgs, {
        string: ['format'],
        default: { format: 'mulaw' },
        alias: { format: 'f' },
    });
    const { format } = parsed;
    const args = parsed._;
    return { format, args };
}

/**
 * @param {string} format
 * @returns {boolean}
 */
export function isSupportedFormat(format) {
    return format === 'mulaw' || format === 'pcm';
}

/**
 * @param {string} format
 * @returns {string}
 */
export function getCodecForFormat(format) {
    return format === 'mulaw' ? 'pcm_mulaw' : 'pcm_s16le';
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
    const ffmpegProcess = new ffmpegModule(inputPath);
    /** @type {any} */
    const video = await ffmpegProcess;
    return new Promise((resolvePromise, rejectPromise) => {
        video
            .setAudioCodec(codec)
            .setAudioChannels(1)
            .setAudioFrequency(8000)
            .addCommand(
                '-af',
                'aresample=resampler=soxr:precision=28:dither_method=triangular'
            )
            .save(
                outputPath,
                /** @type {(error: Error | null, file: string) => void} */
                ((error, file) => {
                if (error) {
                    rejectPromise(error);
                    return;
                }
                resolvePromise(file);
                })
            );
    });
}

/**
 * @param {{
 *  argv?: string[],
 *  logger?: Logger,
 *  exit?: (code?: number) => void,
 *  existsSyncFn?: (path: import('node:fs').PathLike) => boolean,
 *  resolvePath?: (...paths: string[]) => string,
 *  ffmpegModule?: any
 * }=} options
 */
export async function run({
    argv = process.argv,
    logger = console,
    exit = process.exit,
    existsSyncFn = existsSync,
    resolvePath = resolve,
    ffmpegModule = ffmpeg,
} = {}) {
    const rawArgs = argv.slice(2);
    const { format, args } = parseArgs(rawArgs);

    if (!isSupportedFormat(format)) {
        logger.error(`Unsupported format: ${format}`);
        printUsage(logger);
        exit(1);
        return;
    }

    if (args.length < 2) {
        printUsage(logger);
        exit(1);
        return;
    }

    const inputPath = resolvePath(args[0]);
    const outputPath = resolvePath(args[1]);

    if (!existsSyncFn(inputPath)) {
        logger.error(`Input file not found: ${inputPath}`);
        exit(1);
        return;
    }

    const codec = getCodecForFormat(format);

    try {
        await convertWithFfmpeg({ ffmpegModule, inputPath, outputPath, codec });
        logger.log(`Converted ${inputPath} -> ${outputPath} (${format})`);
    } catch (error) {
        logger.error(`Failed to run ffmpeg: ${error?.message || error}`);
        exit(1);
    }
}

const isCli = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
    await run();
}
