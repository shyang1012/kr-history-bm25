import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 파일 순차 실행 — 여러 e2e가 동봉 DB(data/history.sqlite)를 공유해 동시 열기/마이그레이션 시
    // SQLITE_BUSY·손상이 발생한다(CI 신규 checkout). 순차로 공유 파일 경합을 제거한다.
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/**', 'src/index.ts'],
    },
  },
});
