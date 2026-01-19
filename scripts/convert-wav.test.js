import { strict as assert } from 'node:assert';
import test from 'node:test';
import sinon from 'sinon';
import {
    convertWithFfmpeg,
    getCodecForFormat,
    isSupportedFormat,
    parseArgs,
    run,
} from './convert-wav.mjs';

function createLogger() {
    return {
        log: sinon.spy(),
        error: sinon.spy(),
    };
}

function createFfmpegMock(onSave) {
    return function FfmpegMock(inputPath) {
        const video = {
            inputPath,
            codec: null,
            channels: null,
            frequency: null,
            command: null,
            setAudioCodec: sinon.spy(function setAudioCodec(codec) {
                this.codec = codec;
                return this;
            }),
            setAudioChannels: sinon.spy(function setAudioChannels(channels) {
                this.channels = channels;
                return this;
            }),
            setAudioFrequency: sinon.spy(function setAudioFrequency(freq) {
                this.frequency = freq;
                return this;
            }),
            addCommand: sinon.spy(function addCommand(command, value) {
                this.command = { command, value };
                return this;
            }),
            save: sinon.spy(function save(outputPath, callback) {
                if (onSave) {
                    onSave({ outputPath, video: this });
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
    const exit = sinon.spy();

    await run({ argv: ['node', 'convert-wav.mjs'], logger, exit });

    assert.equal(exit.callCount, 1);
    assert.equal(exit.firstCall.args[0], 1);
    assert.equal(logger.log.callCount, 2);
});

test('run exits when input file missing', async () => {
    const logger = createLogger();
    const exit = sinon.spy();

    await run({
        argv: ['node', 'convert-wav.mjs', 'missing.wav', 'out.pcmu'],
        logger,
        exit,
        existsSyncFn: () => false,
        resolvePath: (value) => `/abs/${value}`,
    });

    assert.equal(exit.callCount, 1);
    assert.equal(exit.firstCall.args[0], 1);
    assert.equal(logger.error.firstCall.args[0], 'Input file not found: /abs/missing.wav');
});

test('convertWithFfmpeg configures audio conversion', async () => {
    /** @type {null | { outputPath: string, video: any }} */
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

    assert.ok(saved);
    assert.equal(saved.outputPath, '/abs/output.pcmu');
    assert.equal(saved.video.codec, 'pcm_mulaw');
    assert.equal(saved.video.channels, 1);
    assert.equal(saved.video.frequency, 8000);
    assert.deepEqual(saved.video.command, {
        command: '-af',
        value: 'aresample=resampler=soxr:precision=28:dither_method=triangular',
    });
    assert.equal(saved.video.setAudioCodec.callCount, 1);
    assert.equal(saved.video.setAudioChannels.callCount, 1);
    assert.equal(saved.video.setAudioFrequency.callCount, 1);
    assert.equal(saved.video.addCommand.callCount, 1);
    assert.equal(saved.video.save.callCount, 1);
});

test('run logs success on conversion', async () => {
    const logger = createLogger();
    const exit = sinon.spy();
    const ffmpegMock = createFfmpegMock();

    await run({
        argv: ['node', 'convert-wav.mjs', '--format=mulaw', 'input.wav', 'out.pcmu'],
        logger,
        exit,
        existsSyncFn: () => true,
        resolvePath: (value) => `/abs/${value}`,
        ffmpegModule: ffmpegMock,
    });

    assert.equal(exit.callCount, 0);
    assert.equal(logger.log.firstCall.args[0], 'Converted /abs/input.wav -> /abs/out.pcmu (mulaw)');
});
