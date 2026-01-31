import { strict as assert } from 'node:assert';
import test, { mock } from 'node:test';
import {
    convertWithFfmpeg,
    getCodecForFormat,
    isSupportedFormat,
    isConvertibleWav,
    parseArgs,
    run,
} from './convert-wav.mjs';

function createLogger() {
    return {
        log: mock.fn(),
        error: mock.fn(),
    };
}

/**
 * @param {any} call - Mock call object or arguments array.
 * @returns {any[] | undefined} Call arguments array when available.
 */
function getMockCallArgs(call) {
    return Array.isArray(call) ? call : call?.arguments;
}

/**
 * @param {any} call - Mock call object or arguments array.
 * @param {string} label - Label for assertion messaging.
 * @returns {any[]} Call arguments array.
 */
function getMockCallArgsOrThrow(call, label) {
    const args = getMockCallArgs(call);
    assert.ok(args, `${label} missing mock call arguments`);
    return args;
}

/**
 * @param {(payload: { outputPath: string, video: any }) => void} [onSave] - Callback when save is invoked.
 * @returns {any} Ffmpeg mock class.
 */
function createFfmpegMock(onSave) {
    return class FfmpegMock {
        /** @param {string} inputPath - Input media path. */
        constructor(inputPath) {
            /** @type {any} */
            const video = {
                inputPath,
                codec: null,
                channels: null,
                frequency: null,
                commands: [],
                setAudioCodec: mock.fn((codec) => {
                    video.codec = codec;
                    return video;
                }),
                setAudioChannels: mock.fn((channels) => {
                    video.channels = channels;
                    return video;
                }),
                setAudioFrequency: mock.fn((freq) => {
                    video.frequency = freq;
                    return video;
                }),
                addCommand: mock.fn((command, value) => {
                    video.commands.push({ command, value });
                    return video;
                }),
                save: mock.fn((outputPath, callback) => {
                    if (onSave) {
                        onSave({ outputPath, video });
                    }
                    callback(null, outputPath);
                }),
            };
            return Promise.resolve(video);
        }
    };
}

test('parseArgs defaults format and directory', () => {
    const result = parseArgs(['--format=mulaw', '--dir=assets']);
    assert.equal(result.format, 'mulaw');
    assert.equal(result.dir, 'assets');

    const defaulted = parseArgs([]);
    assert.equal(defaulted.format, 'mulaw');
    assert.equal(defaulted.dir, 'music');

    const aliased = parseArgs(['-f', 'mulaw', '-d', 'assets']);
    assert.equal(aliased.format, 'mulaw');
    assert.equal(aliased.dir, 'assets');
});

test('format helpers validate formats and codecs', () => {
    assert.equal(isSupportedFormat('mulaw'), true);
    assert.equal(isSupportedFormat('pcm'), false);
    assert.equal(isSupportedFormat('mp3'), false);
    assert.equal(getCodecForFormat('mulaw'), 'pcm_mulaw');
});

test('isConvertibleWav excludes .mulaw.wav files', () => {
    assert.equal(isConvertibleWav('tone.wav'), true);
    assert.equal(isConvertibleWav('tone.mulaw.wav'), false);
    assert.equal(isConvertibleWav('TONE.MULAW.WAV'), false);
    assert.equal(isConvertibleWav('tone.mp3'), false);
});

test('run exits when directory missing', async () => {
    const logger = createLogger();
    const exit = mock.fn();

    await run({
        argv: ['node', 'convert-wav.mjs'],
        logger,
        exit,
        existsSyncFn: () => false,
        resolvePath: (value) =>
            value.startsWith('/') ? value : `/abs/${value}`,
    });

    assert.equal(exit.mock.calls.length, 1);
    assert.equal(getMockCallArgsOrThrow(exit.mock.calls[0], 'exit')[0], 1);
    assert.equal(
        getMockCallArgsOrThrow(logger.error.mock.calls[0], 'logger.error')[0],
        'Directory not found: /abs/music'
    );
});

test('run exits when target path is not a directory', async () => {
    const logger = createLogger();
    const exit = mock.fn();

    await run({
        argv: ['node', 'convert-wav.mjs', '--dir=files'],
        logger,
        exit,
        existsSyncFn: () => true,
        statSyncFn: /** @type {any} */ (() => ({ isDirectory: () => false })),
        resolvePath: (value) =>
            value.startsWith('/') ? value : `/abs/${value}`,
    });

    assert.equal(exit.mock.calls.length, 1);
    assert.equal(getMockCallArgsOrThrow(exit.mock.calls[0], 'exit')[0], 1);
    assert.equal(
        getMockCallArgsOrThrow(logger.error.mock.calls[0], 'logger.error')[0],
        'Not a directory: /abs/files'
    );
});

test('convertWithFfmpeg configures audio conversion', async () => {
    /** @type {any} */
    let saved = null;
    const ffmpegMock = createFfmpegMock((payload) => {
        saved = payload;
    });

    await convertWithFfmpeg({
        ffmpegModule: ffmpegMock,
        inputPath: '/abs/input.wav',
        outputPath: '/abs/output.pcmu',
        codec: 'pcm_mulaw',
    });

    if (!saved) {
        throw new Error('Expected ffmpeg save callback to run.');
    }
    assert.equal(saved.outputPath, '/abs/output.pcmu');
    assert.equal(saved.video.codec, null);
    assert.equal(saved.video.channels, 1);
    assert.equal(saved.video.frequency, 8000);
    assert.deepEqual(saved.video.commands, [
        { command: '-c:a', value: 'pcm_mulaw' },
        {
            command: '-af',
            value: 'aresample=resampler=soxr:precision=28:dither_method=triangular',
        },
    ]);
    assert.equal(saved.video.setAudioCodec.mock.calls.length, 0);
    assert.equal(saved.video.setAudioChannels.mock.calls.length, 1);
    assert.equal(saved.video.setAudioFrequency.mock.calls.length, 1);
    assert.equal(saved.video.addCommand.mock.calls.length, 2);
    assert.equal(saved.video.save.mock.calls.length, 1);
});

test('run logs success on conversion', async () => {
    const logger = createLogger();
    const exit = mock.fn();
    const ffmpegMock = createFfmpegMock();

    const dirEntries = [
        /** @type {import('node:fs').Dirent} */ (
            /** @type {any} */ ({ isFile: () => true, name: 'tone.wav' })
        ),
        /** @type {import('node:fs').Dirent} */ (
            /** @type {any} */ ({ isFile: () => true, name: 'tone.mulaw.wav' })
        ),
        /** @type {import('node:fs').Dirent} */ (
            /** @type {any} */ ({ isFile: () => true, name: 'note.txt' })
        ),
    ];

    await run({
        argv: ['node', 'convert-wav.mjs', '--format=mulaw', '--dir=music'],
        logger,
        exit,
        existsSyncFn: () => true,
        statSyncFn: /** @type {any} */ (() => ({ isDirectory: () => true })),
        readdirSyncFn: /** @type {any} */ (() => dirEntries),
        resolvePath: (...values) => `/abs/${values.join('/')}`,
        ffmpegModule: ffmpegMock,
    });

    assert.equal(exit.mock.calls.length, 0);
    assert.equal(
        getMockCallArgsOrThrow(logger.log.mock.calls[0], 'logger.log')[0],
        'Converted /abs/music/tone.wav -> /abs/music/tone.mulaw.wav (mulaw)'
    );
});

test('run logs when no wav files are present', async () => {
    const logger = createLogger();
    const exit = mock.fn();

    await run({
        argv: ['node', 'convert-wav.mjs'],
        logger,
        exit,
        existsSyncFn: () => true,
        statSyncFn: /** @type {any} */ (() => ({ isDirectory: () => true })),
        readdirSyncFn: /** @type {any} */ (
            () => [
                /** @type {import('node:fs').Dirent} */ (
                    /** @type {any} */ ({
                        isFile: () => true,
                        name: 'tone.mulaw.wav',
                    })
                ),
            ]
        ),
        resolvePath: (value) =>
            value.startsWith('/') ? value : `/abs/${value}`,
    });

    assert.equal(exit.mock.calls.length, 0);
    assert.equal(
        getMockCallArgsOrThrow(logger.log.mock.calls[0], 'logger.log')[0],
        'No .wav files to convert in /abs/music'
    );
});
