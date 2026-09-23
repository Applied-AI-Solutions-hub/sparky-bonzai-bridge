import os from 'node:os';
import path from 'node:path';

export interface Config {
  host: string;
  port: number;
  /** JSON file holding device ids, labels and SHA-256 hashes of their bearer tokens. */
  devicesFile: string;
  /** Bridge-owned state: job records and temp message files. */
  stateDir: string;
  /** Notes from devices land here, inside Sparky's workspace, so Sparky can read them. */
  sparkyInboxDir: string;
  /** Sparky writes messages for a device into <outboxDir>/<deviceId>/. */
  outboxDir: string;
  openclawBin: string;
  /** OpenClaw agent id used for device turns. See docs/openclaw-setup.md for a restricted agent. */
  openclawAgent: string;
  /** How long sparky_ask waits for a reply before handing back a job id. */
  askWaitMs: number;
  /** Hard cap for one OpenClaw agent turn. */
  turnTimeoutSeconds: number;
  maxAsksPerHour: number;
  /** How Sparky and the device model refer to the person they work for. */
  ownerName: string;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

function dirPath(name: string, fallback: string): string {
  const raw = process.env[name] || fallback;
  return path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
}

export function loadConfig(): Config {
  const home = os.homedir();
  return {
    host: process.env.BRIDGE_HOST || '127.0.0.1',
    port: positiveNumber('BRIDGE_PORT', 8795),
    devicesFile: dirPath('BRIDGE_DEVICES_FILE', path.join(home, '.config/sparky-bonzai-bridge/devices.json')),
    stateDir: dirPath('BRIDGE_STATE_DIR', path.join(home, '.local/state/sparky-bonzai-bridge')),
    sparkyInboxDir: dirPath('BRIDGE_SPARKY_INBOX_DIR', path.join(home, 'workspace/inbox/bonzai')),
    outboxDir: dirPath('BRIDGE_OUTBOX_DIR', path.join(home, 'workspace/outbox/bonzai')),
    openclawBin: process.env.OPENCLAW_BIN || 'openclaw',
    openclawAgent: process.env.OPENCLAW_AGENT || 'main',
    askWaitMs: positiveNumber('BRIDGE_ASK_WAIT_SECONDS', 75) * 1000,
    turnTimeoutSeconds: positiveNumber('BRIDGE_TURN_TIMEOUT_SECONDS', 900),
    maxAsksPerHour: positiveNumber('BRIDGE_MAX_ASKS_PER_HOUR', 40),
    ownerName: process.env.BRIDGE_OWNER_NAME?.trim() || 'the owner',
  };
}
