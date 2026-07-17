/**
 * @Project: kr-history-bm25
 * @File: examples/agent-lab/.eslintrc.cjs
 * @Description: agent-lab 워크스페이스 ESLint 설정 — 루트 규칙 확장 + 로컬 tsconfig 지정
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
module.exports = {
  root: true,
  extends: ['../../.eslintrc.cjs'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
  overrides: [
    {
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
};
