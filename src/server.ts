import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Bridge } from './bridge.ts';
import type { Config } from './config.ts';
import { authenticate, listDevices } from './devices.ts';
import { registerTools } from './tools.ts';

export const NAME = 'sparky-bonzai-bridge';
export const VERSION = '0.1.0';
const MAX_BODY_BYTES = 1024 * 1024;

const instructions = (owner: string): string => [
  `These tools reach Sparky, ${owner}'s larger AI agent on a home PC.`,
  `Answer simple things yourself. Use sparky_ask for work that needs ${owner}'s files, memory, projects, email, or heavy thinking.`,
  'Use sparky_note when no reply is needed. Check sparky_inbox for messages Sparky left for you.',
].join(' ');

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

export function createHttpServer(cfg: Config, bridge: Bridge): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://bridge');

    if (url.pathname === '/healthz' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, name: NAME, version: VERSION });
    }
    if (url.pathname !== '/mcp') return sendJson(res, 404, { error: 'Not found. The MCP endpoint is /mcp.' });

    // Re-read on every request so `npm run device -- add|remove` takes effect without a restart.
    const device = authenticate(listDevices(cfg.devicesFile), req.headers.authorization);
    if (!device) return sendJson(res, 401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });

    // Stateless server: no standalone SSE stream and no sessions to delete.
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed. Use POST.' }, { Allow: 'POST' });

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: (e as Error).message } });
    }

    // The SDK insists on both media types; some mobile clients send only one.
    // We always answer with plain JSON, so accept either.
    req.headers.accept = 'application/json, text/event-stream';

    const started = Date.now();
    const server = new McpServer({ name: NAME, version: VERSION }, { instructions: instructions(cfg.ownerName) });
    registerTools(server, bridge, device, cfg);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error(`mcp error device=${device.id}: ${(e as Error).message}`);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }

    const calls = [body].flat().filter((m: any) => m?.method === 'tools/call').map((m: any) => m.params?.name);
    if (calls.length) console.log(`device=${device.id} tools=${calls.join(',')} ms=${Date.now() - started} status=${res.statusCode}`);
  });
}
