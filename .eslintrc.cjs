/**
 * @Project: kr-history-bm25
 * @File: .eslintrc.cjs
 * @Description: ESLint 설정 — typescript-eslint recommended + import + Prettier 정합. Airbnb 규칙 정신 반영 (CW-AP-D03 §2)
 * @Author: shyang
 * @LastModified: 2026-07-08
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.eslint.json',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'import/prefer-default-export': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'no-console': 'off',
    eqeqeq: ['error', 'always'],
    curly: ['error', 'all'],
    'max-len': ['warn', { code: 100, ignoreComments: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
  },
  overrides: [
    {
      files: ['tests/**/*.ts', 'src/**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'etc',
    'tmp',
    '*.cjs',
    '*.config.ts',
    'commitlint.config.js',
  ],
};
