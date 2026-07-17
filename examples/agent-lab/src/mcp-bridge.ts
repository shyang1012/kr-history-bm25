/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/mcp-bridge.ts
 * @Description: 신규② McpBridge — MCP SDK 클라이언트 브릿지(connect·listTools·callTool·close) +
 *   에러 정규화. 범용 코어(도메인 무지) — Task 5 call_mcp가 bridge.callTool/listTools를 쓰고,
 *   run.ts가 connect(AGENT_CONFIG.krh)로 붙인다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** McpBridge.connect에 넘기는 stdio MCP 서버 스펙. */
export interface McpServerSpec {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** listTools()가 반환하는 도구 메타(브릿지 소비자용 최소 형태). */
export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 도구레벨 오류({isError:true})를 {error} 로 정규화한다(성공은 passthrough). */
export function normalizeToolResult(r: unknown): unknown {
  if (r && typeof r === 'object' && (r as { isError?: boolean }).isError) {
    return { error: 'tool error', content: (r as { content?: unknown }).content };
  }
  return r;
}

/**
 * MCP stdio 서버에 연결해 도구 목록을 조회하고, 도구 호출 결과를 정규화해 돌려주는 범용 브릿지.
 *   kr-history 도메인을 알지 못한다(R6) — 어떤 서버·도구든 connect/callTool로 동일하게 다룬다.
 */
export class McpBridge {
  private clients = new Map<string, Client>();
  private toolsByServer = new Map<string, ToolInfo[]>();

  /** stdio MCP 서버에 연결하고 도구 목록을 캐시한다. */
  async connect(spec: McpServerSpec): Promise<void> {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: spec.env,
    });
    const client = new Client({ name: 'agent-lab', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    this.clients.set(spec.id, client);
    this.toolsByServer.set(
      spec.id,
      tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      })),
    );
  }

  /** serverId 지정 시 해당 서버의 도구, 미지정 시 연결된 전체 서버의 도구를 평탄화해 반환한다. */
  listTools(serverId?: string): ToolInfo[] {
    if (serverId) {
      return this.toolsByServer.get(serverId) ?? [];
    }
    return [...this.toolsByServer.values()].flat();
  }

  /** 도구를 호출한다. 미등록 서버·throw·isError는 모두 {error} 형태로 정규화한다. */
  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(serverId);
    if (!client) {
      return { error: `unknown server: ${serverId}` };
    }
    try {
      const r = await client.callTool({ name, arguments: args });
      // isError → {error} 정규화(측정 무결성; call_mcp handler가 bridge-error로 계수한다).
      return normalizeToolResult(r);
    } catch (e) {
      return { error: String(e) };
    }
  }

  /** 연결된 모든 클라이언트를 닫고 상태를 비운다. */
  async close(): Promise<void> {
    for (const c of this.clients.values()) {
      await c.close();
    }
    this.clients.clear();
    this.toolsByServer.clear();
  }
}
