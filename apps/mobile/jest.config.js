module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  clearMocks: true,
  // Lucide's package entry is ES modules; tests load its CommonJS build.
  moduleNameMapper: {
    '^lucide-react-native$': require.resolve('lucide-react-native'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@touchgrass/.*))',
  ],
  collectCoverageFrom: ['app/**/*.tsx', 'components/**/*.tsx', 'src/**/*.{ts,tsx}', '!**/*.test.*'],
};
