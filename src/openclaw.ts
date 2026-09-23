import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface AgentTurn {
  agent: string;
  sessionKey: string;
  message: string;
  timeoutSeconds: number;
}

/** Runs one agent turn and resolves with Sparky's reply text. */
export type TurnRunner = (turn: AgentTurn) => Promise<string>;

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      // OpenClaw sometimes exits non-zero after printing a usable result.
      if (err && !stdout.trim()) {
        const detail = String(stderr || err.message).trim().split('\n').slice(-3).join(' ');
        return reject(new Error(err.killed ? 'OpenClaw timed out.' : `OpenClaw failed: ${detail.slice(0, 400)}`));
      }
      resolve(stdout);
    });
  });
}

function parseJsonLoose(raw: string): any {
  try { return JSON.parse(raw); } catch {}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('Could not parse OpenClaw output as JSON.');
}

export function extractReply(stdout: string): string {
  const json = parseJsonLoose(stdout);
  const payloads: Array<{ text?: string }> = json?.result?.payloads ?? json?.payloads ?? [];
  return payloads.map(p => p?.text).filter(Boolean).join('\n\n').trim();
}

export function createTurnRunner(bin: string, tmpDir: string): TurnRunner {
  return async turn => {
    // Pass the message through a file: no argv length limits, no quoting surprises.
    await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    const file = path.join(tmpDir, `msg-${randomUUID()}.txt`);
    await fs.writeFile(file, turn.message, { mode: 0o600 });
    try {
      const stdout = await run(bin, [
        'agent',
        '--agent', turn.agent,
        '--session-key', turn.sessionKey,
        '--message-file', file,
        '--json',
        '--timeout', String(turn.timeoutSeconds),
      ], (turn.timeoutSeconds + 30) * 1000);
      const text = extractReply(stdout);
      if (!text) throw new Error('Sparky finished but returned no text.');
      return text;
    } finally {
      await fs.rm(file, { force: true });
    }
  };
}

export async function openclawHealthy(bin: string): Promise<boolean> {
  try {
    return parseJsonLoose(await run(bin, ['health', '--json'], 15_000))?.ok === true;
  } catch {
    return false;
  }
}
