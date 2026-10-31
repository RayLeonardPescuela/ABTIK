// ESLint (flat config) — shared Expo/React Native rules.
// Run with `npm run lint`.

const { defineConfig } = require('eslint/config');
const globals = require('globals');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['.expo/*', 'dist/*', 'coverage/*'],
  },
  {
    // Node-only helper scripts (asset generation, future codegen).
    files: ['scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]);
