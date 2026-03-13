import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const envModule = await import('../env.js');
const { setYaleLockOpsForTests, resetYaleLockOpsForTests } =
    await import('../utils/yale.js');
const { execute } = await import('./yale-lock.js');

// Mock state that tests can reconfigure
const yaleMock = {
    /** @type {Record<string, any>} */
    locks: {},
    /** @type {any} */
    lockStatus: null,
    /** @type {any} */
    lockResult: null,
    /** @type {any} */
    unlockResult: null,
};

test.beforeEach(() => {
    setYaleLockOpsForTests({
        listLocks: async () => yaleMock.locks,
        getLockStatus: async (/** @type {string | undefined} */ lockId) => {
            if (yaleMock.lockStatus instanceof Error) throw yaleMock.lockStatus;
            return (
                yaleMock.lockStatus || {
                    lockID: lockId || 'LOCK1',
                    status: 'kAugLockState_Locked',
                    doorState: 'kAugDoorState_Closed',
                    state: {
                        locked: true,
                        unlocked: false,
                        closed: true,
                        open: false,
                    },
                }
            );
        },
        lockLock: async (/** @type {string | undefined} */ lockId) => {
            if (yaleMock.lockResult instanceof Error) throw yaleMock.lockResult;
            return (
                yaleMock.lockResult || {
                    lockID: lockId || 'LOCK1',
                    status: 'kAugLockState_Locked',
                    doorState: 'kAugDoorState_Closed',
                    state: {
                        locked: true,
                        unlocked: false,
                        closed: true,
                        open: false,
                    },
                }
            );
        },
        unlockLock: async (/** @type {string | undefined} */ lockId) => {
            if (yaleMock.unlockResult instanceof Error)
                throw yaleMock.unlockResult;
            return (
                yaleMock.unlockResult || {
                    lockID: lockId || 'LOCK1',
                    status: 'kAugLockState_Unlocked',
                    doorState: 'kAugDoorState_Closed',
                    state: {
                        locked: false,
                        unlocked: true,
                        closed: true,
                        open: false,
                    },
                }
            );
        },
    });
});

test.afterEach(() => {
    resetYaleLockOpsForTests();
    yaleMock.locks = {};
    yaleMock.lockStatus = null;
    yaleMock.lockResult = null;
    yaleMock.unlockResult = null;
});

test('yale-lock.execute rejects non-primary caller', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    try {
        const res = /** @type {any} */ (
            await execute({
                args: { action: 'status' },
                context: { currentCallerE164: '+19995550000' },
            })
        );
        assert.equal(res.status, 'error');
        assert.match(res.message, /primary callers/);
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((v) => envModule.PRIMARY_CALLERS_SET.add(v));
    }
});

test('yale-lock.execute rejects missing caller', async () => {
    const res = /** @type {any} */ (
        await execute({
            args: { action: 'status' },
            context: {},
        })
    );
    assert.equal(res.status, 'error');
    assert.match(res.message, /primary callers/);
});

test('yale-lock.execute lists locks for primary caller', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    yaleMock.locks = {
        LOCK1: {
            LockName: 'Front door',
            UserType: 'superuser',
            macAddress: '1A:2B:3C:4D:5E:6F',
            HouseID: 'house1',
            HouseName: 'Home',
        },
    };
    try {
        const res = /** @type {any} */ (
            await execute({
                args: { action: 'list' },
                context: { currentCallerE164: '+12065550100' },
            })
        );
        assert.equal(res.status, 'ok');
        assert.equal(res.action, 'list');
        assert.ok(res.locks.LOCK1);
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((v) => envModule.PRIMARY_CALLERS_SET.add(v));
    }
});

test('yale-lock.execute gets lock status', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    yaleMock.lockStatus = {
        lockID: 'LOCK1',
        status: 'kAugLockState_Locked',
        doorState: 'kAugDoorState_Closed',
        state: { locked: true, unlocked: false, closed: true, open: false },
    };
    try {
        const res = /** @type {any} */ (
            await execute({
                args: {
                    action: 'status',
                    lock_id: 'LOCK1',
                    lock_name: 'Front door',
                },
                context: { currentCallerE164: '+12065550100' },
            })
        );
        assert.equal(res.status, 'ok');
        assert.equal(res.action, 'status');
        assert.equal(res.lock_name, 'Front door');
        assert.equal(res.lock.state.locked, true);
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((v) => envModule.PRIMARY_CALLERS_SET.add(v));
    }
});

test('yale-lock.execute locks a lock', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    yaleMock.lockResult = {
        lockID: 'LOCK1',
        status: 'kAugLockState_Locked',
        doorState: 'kAugDoorState_Closed',
        state: { locked: true, unlocked: false, closed: true, open: false },
    };
    try {
        const res = /** @type {any} */ (
            await execute({
                args: { action: 'lock', lock_id: 'LOCK1' },
                context: { currentCallerE164: '+12065550100' },
            })
        );
        assert.equal(res.status, 'ok');
        assert.equal(res.action, 'lock');
        assert.equal(res.lock.state.locked, true);
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((v) => envModule.PRIMARY_CALLERS_SET.add(v));
    }
});

test('yale-lock.execute unlocks a lock', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    yaleMock.unlockResult = {
        lockID: 'LOCK1',
        status: 'kAugLockState_Unlocked',
        doorState: 'kAugDoorState_Closed',
        state: { locked: false, unlocked: true, closed: true, open: false },
    };
    try {
        const res = /** @type {any} */ (
            await execute({
                args: { action: 'unlock', lock_id: 'LOCK1' },
                context: { currentCallerE164: '+12065550100' },
            })
        );
        assert.equal(res.status, 'ok');
        assert.equal(res.action, 'unlock');
        assert.equal(res.lock.state.unlocked, true);
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((v) => envModule.PRIMARY_CALLERS_SET.add(v));
    }
});

test('yale-lock.execute rejects unknown action', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    try {
        const res = /** @type {any} */ (
            await execute({
                args: { action: 'destroy' },
                context: { currentCallerE164: '+12065550100' },
            })
        );
        assert.equal(res.status, 'error');
        assert.match(res.message, /Unknown action/);
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((v) => envModule.PRIMARY_CALLERS_SET.add(v));
    }
});
