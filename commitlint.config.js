/**
 * @Project: kr-history-bm25
 * @File: commitlint.config.js
 * @Description: Conventional Commits 강제 (CW-AP-D03 §7)
 * @Author: shyang
 * @LastModified: 2026-07-08
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['ingest', 'parser', 'search', 'translate', 'db', 'cli', 'entity', 'deps', 'docs', 'test'],
    ],
  },
};
