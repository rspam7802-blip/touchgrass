import globals from 'globals';
import { base } from './base.js';

export function node(tsconfigRootDir) {
  return [...base(tsconfigRootDir), { languageOptions: { globals: { ...globals.node } } }];
}
