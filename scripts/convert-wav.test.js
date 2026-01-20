import { strict as assert } from 'node:assert';
import test, { mock } from 'node:test';
import {
    convertWithFfmpeg,
    getCodecForFormat,
    isSupportedFormat,
    parseArgs,
    run,
} from './convert-wav.mjs';

function createLogger() {
    return {
        log: mock.fn(),
        error: mock.fn(),
    };
}

function getMockCallArgs(call) {
    return Array.isArray(call) ? call : call?.arguments;
}

function createFfmpegMock(onSave) {
    return function FfmpegMock(inputPath) {
        /** @type {any} */
        const video = {
            inputPath,
            codec: null,
            channels: null,
            frequency: null,
            command: null,
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
                video.command = { command, value };
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
    };
}

test('parseArgs defaults format and strips flag', () => {
    const result = parseArgs(['--format=pcm', 'input.wav', 'output.wav']);
    assert.equal(result.format, 'pcm');
    assert.deepEqual(result.args, ['input.wav', 'output.wav']);

    const defaulted = parseArgs(['input.wav', 'output.wav']);
    assert.equal(defaulted.format, 'mulaw');

    const aliased = parseArgs(['-f', 'pcm', 'input.wav', 'output.wav']);
    assert.equal(aliased.format, 'pcm');
    assert.deepEqual(aliased.args, ['input.wav', 'output.wav']);
});

test('format helpers validate formats and codecs', () => {
    assert.equal(isSupportedFormat('mulaw'), true);
    assert.equal(isSupportedFormat('pcm'), true);
    assert.equal(isSupportedFormat('mp3'), false);
    assert.equal(getCodecForFormat('mulaw'), 'pcm_mulaw');
    assert.equal(getCodecForFormat('pcm'), 'pcm_s16le');
});

test('run exits with usage when missing args', async () => {
    const logger = createLogger();
    const exit = mock.fn();

    await run({ argv: ['node', 'convert-wav.mjs'], logger, exit });

    assert.equal(exit.mock.calls.length, 1);
    assert.equal(getMockCallArgs(exit.mock.calls[0])[0], 1);
    assert.equal(logger.log.mock.calls.length, 2);
});

test('run exits when input file missing', async () => {
    const logger = createLogger();
    const exit = mock.fn();

    await run({
        argv: ['node', 'convert-wav.mjs', 'missing.wav', 'out.pcmu'],
        logger,
        exit,
        existsSyncFn: () => false,
        resolvePath: (value) => `/abs/${value}`,
    });

    assert.equal(exit.mock.calls.length, 1);
    assert.equal(getMockCallArgs(exit.mock.calls[0])[0], 1);
    assert.equal(
        getMockCallArgs(logger.error.mock.calls[0])[0],
        'Input file not found: /abs/missing.wav'
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
    assert.equal(saved.video.codec, 'pcm_mulaw');
    assert.equal(saved.video.channels, 1);
    assert.equal(saved.video.frequency, 8000);
    assert.deepEqual(saved.video.command, {
        command: '-af',
        value: 'aresample=resampler=soxr:precision=28:dither_method=triangular',
    });
    assert.equal(saved.video.setAudioCodec.mock.calls.length, 1);
    assert.equal(saved.video.setAudioChannels.mock.calls.length, 1);
    assert.equal(saved.video.setAudioFrequency.mock.calls.length, 1);
    assert.equal(saved.video.addCommand.mock.calls.length, 1);
    assert.equal(saved.video.save.mock.calls.length, 1);
});

test('run logs success on conversion', async () => {
    const logger = createLogger();
    const exit = mock.fn();
    const ffmpegMock = createFfmpegMock();

    await run({
        argv: [
            'node',
            'convert-wav.mjs',
            '--format=mulaw',
            'input.wav',
            'out.pcmu',
        ],
        logger,
        exit,
        existsSyncFn: () => true,
        resolvePath: (value) => `/abs/${value}`,
        ffmpegModule: ffmpegMock,
    });

    assert.equal(exit.mock.calls.length, 0);
    assert.equal(
        getMockCallArgs(logger.log.mock.calls[0])[0],
        'Converted /abs/input.wav -> /abs/out.pcmu (mulaw)'
    );
});
