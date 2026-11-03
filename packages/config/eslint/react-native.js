import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import rnA11y from 'eslint-plugin-react-native-a11y';
import { base } from './base.js';

export function reactNative(tsconfigRootDir) {
  return [
    ...base(tsconfigRootDir),
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: { react, 'react-hooks': reactHooks, 'react-native-a11y': rnA11y },
      languageOptions: { globals: { ...globals.browser, ...globals.node } },
      settings: { react: { version: 'detect' } },
      rules: {
        ...react.configs.recommended.rules,
        ...react.configs['jsx-runtime'].rules,
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
        ...rnA11y.configs.all.rules,
        'react/prop-types': 'off',
        // Hints are for actions whose result is not obvious (Apple HIG); requiring one on every labelled
        // element makes screen readers noisier. We add hints deliberately instead (docs/DECISIONS.md D-021).
        'react-native-a11y/has-accessibility-hint': 'off',
      },
    },
  ];
}
