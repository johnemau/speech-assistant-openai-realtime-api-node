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
      ecmaVersion: 2023,
      sourceType: 'module'
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-constant-condition': ['warn', { checkLoops: false }]
    }
  }
];
