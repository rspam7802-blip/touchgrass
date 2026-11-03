import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Accessibility audit over every screen and component (F-A11Y-01, Phase 12). A static pass, so no screen is
 * skipped for lack of fixtures:
 * - pressables carry a role and a label (screen readers announce what it is and what it does);
 * - text inputs and switches carry a label;
 * - images are either labelled or explicitly decorative;
 * - text only through the UI kit's `Text`, which caps font scaling at 200% (`maxFontSizeMultiplier` 2).
 * Wrappers that forward props with a spread (`{...rest}`) are checked where they are used instead.
 */
const ROOT = join(__dirname, '..');
const PRESSABLES = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

function audit(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fromReactNative = new Set<string>();
  for (const s of src.statements) {
    if (
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === 'react-native' &&
      s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings)
    )
      for (const e of s.importClause.namedBindings.elements) fromReactNative.add(e.name.text);
  }
  const problems: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(src);
      const props = node.attributes.properties;
      const has = (name: string): boolean =>
        props.some((p) => ts.isJsxAttribute(p) && p.name.getText(src) === name);
      const spread = props.some((p) => ts.isJsxSpreadAttribute(p));
      const where = `${relative(ROOT, file)}:${String(src.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;
      if (PRESSABLES.has(tag) && !spread) {
        if (!has('accessibilityRole')) problems.push(`${where} ${tag} without accessibilityRole`);
        if (!has('accessibilityLabel')) problems.push(`${where} ${tag} without accessibilityLabel`);
      }
      if ((tag === 'TextInput' || tag === 'Switch') && !spread && !has('accessibilityLabel'))
        problems.push(`${where} ${tag} without accessibilityLabel`);
      if (
        tag === 'Image' &&
        !has('accessibilityLabel') &&
        !(has('accessible') && has('importantForAccessibility'))
      )
        problems.push(`${where} Image neither labelled nor marked decorative`);
      if (tag === 'Text' && fromReactNative.has('Text') && !file.endsWith(join('ui', 'Text.tsx')))
        problems.push(`${where} react-native Text (use components/ui Text)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return problems;
}

describe('accessibility audit (F-A11Y-01)', () => {
  const files = [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'components'))];

  it('covers every screen and component', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('every interactive element and image is accessible', () => {
    expect(files.flatMap(audit)).toEqual([]);
  });

  it('flags what it is meant to flag', () => {
    const dir = join(ROOT, 'components');
    const probe = join(dir, '__probe__.tsx');
    const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
    fs.writeFileSync(
      probe,
      [
        "import { Image, Pressable, Text, TextInput } from 'react-native';",
        'export const P = () => (',
        '  <Pressable onPress={() => undefined}>',
        '    <Text>Go</Text>',
        "    <Image source={{ uri: 'x' }} />",
        '    <TextInput />',
        '  </Pressable>',
        ');',
      ].join('\n'),
    );
    try {
      expect(audit(probe).map((p) => p.replace(/^.*?:\d+ /, ''))).toEqual([
        'Pressable without accessibilityRole',
        'Pressable without accessibilityLabel',
        'react-native Text (use components/ui Text)',
        'Image neither labelled nor marked decorative',
        'TextInput without accessibilityLabel',
      ]);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
