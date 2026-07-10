import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/krh': 'src/cli/krh.ts',
    'mcp/server': 'src/mcp/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  splitting: false,
  // @libsql/client ships native prebuilt bindings — keep it external so the consumer resolves it.
  // MCP SDK·zod는 런타임 의존성 — 번들하지 않고 소비자가 resolve.
  external: ['@libsql/client', '@anthropic-ai/sdk', '@modelcontextprotocol/sdk', 'zod'],
});
