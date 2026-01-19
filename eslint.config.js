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
  // Project JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'eqeqeq': ['warn', 'always'],
      'curly': ['warn', 'all'],
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-octal': 'error',
      'no-proto': 'error',
      'no-return-await': 'error',
      'no-shadow-restricted-names': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-useless-catch': 'error',
      'no-var': 'error',
      'prefer-const': ['warn', { destructuring: 'all' }],
      'prefer-template': 'warn',
      'object-shorthand': ['warn', 'always'],
      'no-useless-escape': 'warn',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message: 'Use createOpenAIClient from src/utils/clients.js so configuration is centralized.'
            },
            {
              name: 'twilio',
              message: 'Use createTwilioClient from src/utils/clients.js; direct SDK use should be limited to TwiML helpers.'
            },
            {
              name: 'fastify',
              message: 'Fastify should only be initialized in index.js.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/utils/clients.js'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  {
    files: ['src/testing/voice-test-runner.js'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  {
    files: ['src/routes/sms.js'],
    rules: {
      'no-restricted-imports': 'off'
    }
  },
  {
    files: ['index.js'],
    rules: {
      'no-restricted-imports': 'off'
    }
  }
];
