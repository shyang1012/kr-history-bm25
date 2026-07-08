import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/krh': 'src/cli/krh.ts',
  },
  format: ['esm', 'cjs'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  splitting: false,
  // @libsql/client ships native prebuilt bindings — keep it external so the consumer resolves it.
  external: ['@libsql/client', '@anthropic-ai/sdk'],
});
