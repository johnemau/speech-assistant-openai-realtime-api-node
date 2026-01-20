import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCallerName, getTimeGreeting } from './calls.js';

test('calls.resolveCallerName resolves primary, secondary, fallback', () => {
    const primarySet = new Set(['+12065550100']);
    const secondarySet = new Set(['+12065550101']);

    assert.equal(
        resolveCallerName({
            callerE164: '+12065550100',
            primaryCallersSet: primarySet,
            secondaryCallersSet: secondarySet,
            primaryName: 'Primary',
            secondaryName: 'Secondary',
        }),
        'Primary'
    );

    assert.equal(
        resolveCallerName({
            callerE164: '+12065550101',
            primaryCallersSet: primarySet,
            secondaryCallersSet: secondarySet,
            primaryName: 'Primary',
            secondaryName: 'Secondary',
        }),
        'Secondary'
    );

    assert.equal(
        resolveCallerName({
            callerE164: '+12065550102',
            primaryCallersSet: primarySet,
            secondaryCallersSet: secondarySet,
            primaryName: 'Primary',
            secondaryName: 'Secondary',
            fallbackName: 'Legend',
        }),
        'Legend'
    );
});

test('calls.getTimeGreeting returns expected greeting by hour', () => {
    const morning = new Date(Date.UTC(2020, 0, 1, 5, 0, 0));
    const afternoon = new Date(Date.UTC(2020, 0, 1, 12, 0, 0));
    const evening = new Date(Date.UTC(2020, 0, 1, 19, 0, 0));

    assert.equal(
        getTimeGreeting({ timeZone: 'UTC', now: morning }),
        'Good morning'
    );
    assert.equal(
        getTimeGreeting({ timeZone: 'UTC', now: afternoon }),
        'Good afternoon'
    );
    assert.equal(
        getTimeGreeting({ timeZone: 'UTC', now: evening }),
        'Good evening'
    );
});
