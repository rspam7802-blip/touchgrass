import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import nextPlugin from '@next/eslint-plugin-next';
import { base } from './base.js';

export function next(tsconfigRootDir) {
  return [
    ...base(tsconfigRootDir),
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y, '@next/next': nextPlugin },
      languageOptions: { globals: { ...globals.browser, ...globals.node } },
      settings: { react: { version: 'detect' } },
      rules: {
        ...react.configs.recommended.rules,
        ...react.configs['jsx-runtime'].rules,
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
        ...jsxA11y.configs.strict.rules,
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules,
        'react/prop-types': 'off',
      },
    },
  ];
}
