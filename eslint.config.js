import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore patterns (replaces .eslintignore)
  {
    ignores: [
      'node_modules',
      'coverage',
      'dist',
      'build',
      'assets',
      '**/*.min.js'
    ]
  },
  {
    ...js.configs.recommended,
    files: ['**/*.js']
  },
  // Project JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-case-declarations': 'off'
    }
  }
];
