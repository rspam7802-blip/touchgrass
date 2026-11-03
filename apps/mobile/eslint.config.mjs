import { reactNative } from '@touchgrass/config/eslint/react-native';

export default [
  ...reactNative(import.meta.dirname),
  {
    ignores: [
      'scripts/**',
      'babel.config.js',
      'metro.config.js',
      'jest.config.js',
      '.expo/**',
      'expo-env.d.ts',
      'android/**',
      'ios/**',
    ],
  },
];
