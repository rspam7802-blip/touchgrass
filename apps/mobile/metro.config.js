// Expo's default config auto-detects the pnpm monorepo (hoisted node_modules) and watches workspace packages.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
