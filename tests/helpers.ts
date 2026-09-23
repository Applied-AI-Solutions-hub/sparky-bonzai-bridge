import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Bridge } from '../src/bridge.ts';
import type { Config } from '../src/config.ts';
import { addDevice } from '../src/devices.ts';
import { createTurnRunner } from '../src/openclaw.ts';
import { createHttpServer } from '../src/server.ts';

const FAKE_OPENCLAW = path.join(import.meta.dirname, 'fixtures', 'fake-openclaw.mjs');
fs.chmodSync(FAKE_OPENCLAW, 0o755);

export interface Harness {
  url: string;
  cfg: Config;
  bridge: Bridge;
  tokens: { iphone: string; ipad: string };
  connect(token: string): Promise<Client>;
  call(client: Client, name: string, args?: Record<string, unknown>): Promise<{ isError: boolean; text: string; json: any }>;
  close(): Promise<void>;
}

export async function startHarness(overrides: Partial<Config> = {}): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbb-test-'));
  const cfg: Config = {
    host: '127.0.0.1',
    port: 0,
    devicesFile: path.join(root, 'config', 'devices.json'),
    stateDir: path.join(root, 'state'),
    sparkyInboxDir: path.join(root, 'workspace', 'inbox', 'bonzai'),
    outboxDir: path.join(root, 'workspace', 'outbox', 'bonzai'),
    openclawBin: FAKE_OPENCLAW,
    openclawAgent: 'sparky-mobile',
    askWaitMs: 2000,
    turnTimeoutSeconds: 30,
    maxAsksPerHour: 40,
    ownerName: 'the owner',
    ...overrides,
  };
  const tokens = {
    iphone: addDevice(cfg.devicesFile, 'iphone', 'Kit'),
    ipad: addDevice(cfg.devicesFile, 'ipad', 'Nox'),
  };
  const bridge = new Bridge(cfg, createTurnRunner(cfg.openclawBin, path.join(cfg.stateDir, 'tmp')));
  const server = createHttpServer(cfg, bridge);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const clients: Client[] = [];

  return {
    url,
    cfg,
    bridge,
    tokens,
    async connect(token) {
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }));
      clients.push(client);
      return client;
    },
    async call(client, name, args = {}) {
      const res = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
      const text = res.content.map(c => c.text).join('');
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      return { isError: Boolean(res.isError), text, json };
    },
    async close() {
      await Promise.all(clients.map(c => c.close()));
      await bridge.idle();
      await new Promise(r => server.close(r));
      server.closeAllConnections();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
