import test from 'node:test';
import assert from 'node:assert/strict';

import { getAugustClient, resetAugustClientForTests } from './yale.js';

test('yale.getAugustClient returns null when env vars missing', () => {
    resetAugustClientForTests();
    const prev = {
        AUGUST_INSTALL_ID: process.env.AUGUST_INSTALL_ID,
        AUGUST_ID: process.env.AUGUST_ID,
        AUGUST_PASSWORD: process.env.AUGUST_PASSWORD,
    };
    delete process.env.AUGUST_INSTALL_ID;
    delete process.env.AUGUST_ID;
    delete process.env.AUGUST_PASSWORD;
    try {
        const client = getAugustClient();
        assert.equal(client, null);
    } finally {
        resetAugustClientForTests();
        if (prev.AUGUST_INSTALL_ID != null)
            process.env.AUGUST_INSTALL_ID = prev.AUGUST_INSTALL_ID;
        if (prev.AUGUST_ID != null) process.env.AUGUST_ID = prev.AUGUST_ID;
        if (prev.AUGUST_PASSWORD != null)
            process.env.AUGUST_PASSWORD = prev.AUGUST_PASSWORD;
    }
});

test('yale.getAugustClient creates client when env vars set', () => {
    resetAugustClientForTests();
    const prev = {
        AUGUST_INSTALL_ID: process.env.AUGUST_INSTALL_ID,
        AUGUST_ID: process.env.AUGUST_ID,
        AUGUST_PASSWORD: process.env.AUGUST_PASSWORD,
    };
    process.env.AUGUST_INSTALL_ID = 'test-install';
    process.env.AUGUST_ID = 'test@example.com';
    process.env.AUGUST_PASSWORD = 'test-password';
    try {
        const client = getAugustClient();
        assert.ok(client);
        // Subsequent calls return the same instance
        const client2 = getAugustClient();
        assert.strictEqual(client, client2);
    } finally {
        resetAugustClientForTests();
        if (prev.AUGUST_INSTALL_ID == null)
            delete process.env.AUGUST_INSTALL_ID;
        else process.env.AUGUST_INSTALL_ID = prev.AUGUST_INSTALL_ID;
        if (prev.AUGUST_ID == null) delete process.env.AUGUST_ID;
        else process.env.AUGUST_ID = prev.AUGUST_ID;
        if (prev.AUGUST_PASSWORD == null) delete process.env.AUGUST_PASSWORD;
        else process.env.AUGUST_PASSWORD = prev.AUGUST_PASSWORD;
    }
});

test('yale.resetAugustClientForTests clears singleton', () => {
    resetAugustClientForTests();
    const prev = {
        AUGUST_INSTALL_ID: process.env.AUGUST_INSTALL_ID,
        AUGUST_ID: process.env.AUGUST_ID,
        AUGUST_PASSWORD: process.env.AUGUST_PASSWORD,
    };
    process.env.AUGUST_INSTALL_ID = 'test-install';
    process.env.AUGUST_ID = 'test@example.com';
    process.env.AUGUST_PASSWORD = 'test-password';
    try {
        const client1 = getAugustClient();
        assert.ok(client1);
        resetAugustClientForTests();
        // After reset, next call creates a new instance
        const client2 = getAugustClient();
        assert.ok(client2);
        assert.notStrictEqual(client1, client2);
    } finally {
        resetAugustClientForTests();
        if (prev.AUGUST_INSTALL_ID == null)
            delete process.env.AUGUST_INSTALL_ID;
        else process.env.AUGUST_INSTALL_ID = prev.AUGUST_INSTALL_ID;
        if (prev.AUGUST_ID == null) delete process.env.AUGUST_ID;
        else process.env.AUGUST_ID = prev.AUGUST_ID;
        if (prev.AUGUST_PASSWORD == null) delete process.env.AUGUST_PASSWORD;
        else process.env.AUGUST_PASSWORD = prev.AUGUST_PASSWORD;
    }
});
