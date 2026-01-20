import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import tsParser from '@typescript-eslint/parser';

export default [
    // Ignore patterns (replaces .eslintignore)
    {
        ignores: [
            'node_modules',
            'coverage',
            'dist',
            'build',
            'assets',
            '**/*.min.js',
        ],
    },
    {
        ...js.configs.recommended,
        files: ['**/*.js'],
    },
    // Project JS files
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parser: tsParser,
            globals: {
                ...globals.node,
                ...globals.es2021,
            },
        },
        plugins: {
            jsdoc,
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
        settings: {
            jsdoc: {
                mode: 'typescript',
            },
        },
        rules: {
            'no-unused-vars': [
                'error',
                { args: 'none', ignoreRestSiblings: true },
            ],
            'jsdoc/require-returns': 'error',
            'jsdoc/require-returns-description': 'warn',
            'jsdoc/require-returns-type': 'error',
            'jsdoc/check-types': ['error', { noDefaults: true }],
            'jsdoc/require-param': 'error',
            'jsdoc/require-param-type': 'error',
            'jsdoc/require-param-description': 'warn',
            'jsdoc/check-param-names': 'error',
            'jsdoc/check-property-names': 'error',
            'jsdoc/require-property': 'warn',
            'jsdoc/require-property-type': 'error',
            'jsdoc/require-jsdoc': [
                'warn',
                {
                    publicOnly: true,
                    require: {
                        FunctionDeclaration: true,
                        ClassDeclaration: true,
                        MethodDefinition: true,
                    },
                },
            ],
        },
    },
];
