// Global test setup to stabilize timezone/locale across environments.
process.env.TZ = 'UTC';
process.env.LANG = process.env.LANG || 'en_US.UTF-8';
process.env.LC_ALL = process.env.LC_ALL || 'en_US.UTF-8';
// Provide a dummy API key so modules that import init.js don't call process.exit(1).
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
