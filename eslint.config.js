import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

// Exports include exported function declarations; selectors cover assigned functions.
const functionStatements = [
  'function',
  'export',
  { selector: 'VariableDeclaration[declarations.0.init.type="ArrowFunctionExpression"]' },
  { selector: 'VariableDeclaration[declarations.0.init.type="FunctionExpression"]' },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.pnpm-store/**',
      '.wrangler/**',
      'dist/**',
      '.release/**',
      'worker-configuration.d.ts',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { '@stylistic': stylistic },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: functionStatements },
        { blankLine: 'always', prev: functionStatements, next: '*' },
      ],
      '@stylistic/lines-between-class-members': [
        'error',
        {
          enforce: [
            { blankLine: 'always', prev: '*', next: 'method' },
            { blankLine: 'always', prev: 'method', next: '*' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@cloudflare/*',
            'cloudflare:*',
            '@modelcontextprotocol/*',
            '../intervals/*',
            '../auth/*',
            '../server/*',
            '../config/*',
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
