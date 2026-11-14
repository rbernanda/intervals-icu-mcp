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
      'skills/intervals-training-analyst-workspace/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: { '@stylistic': stylistic },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
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
    files: ['src/analytics/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@cloudflare/*',
            'cloudflare:*',
            '@modelcontextprotocol/*',
            '**/intervals/*',
            '**/auth/*',
            '**/server/*',
            '**/config/*',
            '**/tools/*',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'fetch', 'process'],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Fetch and KV doubles intentionally return promises without asynchronous work.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['scripts/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
