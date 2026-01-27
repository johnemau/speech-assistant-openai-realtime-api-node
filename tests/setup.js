// Global test setup to stabilize timezone/locale across environments.
process.env.TZ = 'UTC';
process.env.LANG = process.env.LANG || 'en_US.UTF-8';
process.env.LC_ALL = process.env.LC_ALL || 'en_US.UTF-8';
