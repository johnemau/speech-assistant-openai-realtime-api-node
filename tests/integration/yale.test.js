import test from 'node:test';
import assert from 'node:assert/strict';
import August from 'august-yale';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const installId = process.env.AUGUST_INSTALL_ID;
const augustId = process.env.AUGUST_ID;
const password = process.env.AUGUST_PASSWORD;

let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/yale.js')>} Module import.
 */
async function loadYaleModule() {
    importCounter += 1;
    return import(`../../src/utils/yale.js?integration=${importCounter}`);
}

/**
 * Check if a 401 error (needs 2FA validation).
 *
 * @param {unknown} err - Error to check.
 * @returns {boolean} True if it's a 401 auth error.
 */
function isAuthError(err) {
    return err instanceof Error && /401/.test(err.message);
}

// --- env-var presence tests ---

test('requires AUGUST_INSTALL_ID', () => {
    assert.ok(
        installId,
        'AUGUST_INSTALL_ID must be set in the environment or .env file.'
    );
});

test('requires AUGUST_ID', () => {
    assert.ok(
        augustId,
        'AUGUST_ID must be set in the environment or .env file.'
    );
});

test('requires AUGUST_PASSWORD', () => {
    assert.ok(
        password,
        'AUGUST_PASSWORD must be set in the environment or .env file.'
    );
});

// --- client creation ---

test('getAugustClient returns a configured client', async () => {
    const { getAugustClient, resetAugustClientForTests } =
        await loadYaleModule();
    try {
        const client = getAugustClient();
        assert.ok(client, 'Expected an August client instance');
    } finally {
        resetAugustClientForTests();
    }
});

test('August constructor accepts env credentials', () => {
    assert.doesNotThrow(() => {
        const client = new August({ installId, augustId, password });
        assert.ok(client);
    });
});

// --- authorize (first step of 2FA) ---

test('authorize resolves without throwing', async () => {
    const client = new August({ installId, augustId, password });
    const result = await client.authorize();
    assert.equal(result, true, 'authorize() should return true');
});

// --- live API tests (skipped when 2FA validation is pending) ---

test('listLocks returns locks or skips on 401', async (t) => {
    const { listLocks } = await loadYaleModule();
    try {
        const locks = await listLocks();
        assert.ok(
            locks && typeof locks === 'object',
            'Expected a locks object'
        );
        for (const [id, info] of Object.entries(locks)) {
            assert.ok(typeof id === 'string', 'Lock ID should be a string');
            assert.ok(info.LockName, 'Each lock should have a LockName');
            assert.ok(info.UserType, 'Each lock should have a UserType');
            assert.ok(info.HouseID, 'Each lock should have a HouseID');
            assert.ok(info.HouseName, 'Each lock should have a HouseName');
        }
    } catch (err) {
        if (isAuthError(err)) {
            t.skip('Yale API returned 401; 2FA validation required. Skipping.');
            return;
        }
        throw err;
    }
});

test('getLockStatus returns status or skips on 401', async (t) => {
    const { listLocks, getLockStatus } = await loadYaleModule();
    try {
        const locks = await listLocks();
        const lockIds = Object.keys(locks);
        if (lockIds.length === 0) {
            t.skip('No locks on account.');
            return;
        }

        const status = await getLockStatus(lockIds[0]);
        assert.ok(status, 'Expected a status response');
        assert.ok(
            typeof status === 'object',
            'Expected status to be an object'
        );
        assert.ok(status.status, 'Expected a status string');
        assert.match(
            status.status,
            /^kAugLockState_/,
            'Status should start with kAugLockState_'
        );
        assert.ok(status.lockID, 'Expected a lockID in response');
        assert.ok(
            status.state && typeof status.state === 'object',
            'Expected a state object'
        );
        assert.equal(typeof status.state.locked, 'boolean');
        assert.equal(typeof status.state.unlocked, 'boolean');
    } catch (err) {
        if (isAuthError(err)) {
            t.skip('Yale API returned 401; 2FA validation required. Skipping.');
            return;
        }
        throw err;
    }
});
