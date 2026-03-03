#!/usr/bin/env node

/**
 * Session End Hook: Auto-run tests based on modified file categories
 *
 * This script runs at the end of a session and detects which categories
 * of files were modified, then runs the appropriate test suite:
 * - src/routes/ → npm run test:integration
 * - src/assistant/prompts/ → npm run pf:eval
 * - src/tools/ → npm test
 */

import { execSync } from 'child_process';
import path from 'path';

const categories = {
    routes: {
        pattern: /^src\/routes\//,
        command: 'npm run test:integration',
        description: 'Routes Integration Tests',
    },
    prompts: {
        pattern: /^src\/assistant\/prompts\//,
        command: 'npm run pf:eval',
        description: 'Prompt Evaluations',
    },
    tools: {
        pattern: /^src\/tools\//,
        command: 'npm test',
        description: 'Full Test Suite (Tools)',
    },
};

// Get modified files from session context (would be provided by the hook system)
// This is a placeholder - in production, this would read from session context
const modifiedFiles =
    process.env.MODIFIED_FILES?.split(',').map((f) => f.trim()) || [];

if (modifiedFiles.length === 0) {
    console.log('✓ No files modified this session, skipping tests.');
    process.exit(0);
}

const categoriesToTest = new Set();

// Determine which categories need testing
for (const file of modifiedFiles) {
    for (const [category, config] of Object.entries(categories)) {
        if (config.pattern.test(file)) {
            categoriesToTest.add(category);
        }
    }
}

if (categoriesToTest.size === 0) {
    console.log("✓ Modified files don't require automated tests.");
    process.exit(0);
}

console.log('\n🧪 Running tests for modified categories:\n');

let hasErrors = false;

for (const category of categoriesToTest) {
    const config = categories[category];
    console.log(`📍 ${config.description}`);
    console.log(`   Running: ${config.command}\n`);

    try {
        execSync(config.command, { stdio: 'inherit', cwd: process.cwd() });
        console.log(`✓ ${config.description} passed\n`);
    } catch (error) {
        console.error(`✗ ${config.description} failed`);
        hasErrors = true;
    }
}

if (hasErrors) {
    console.error(
        '\n❌ Some tests failed. Please review and fix before completing.'
    );
    process.exit(1);
} else {
    console.log('\n✅ All tests passed successfully!');
    process.exit(0);
}
