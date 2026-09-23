import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Device } from './devices.ts';

export interface OutboxMessage {
  id: string;
  at: string;
  text: string;
}

const MESSAGE_ID = /^[\w][\w.-]{0,127}$/;
const MAX_MESSAGE_CHARS = 4000;

/**
 * Two plain-file mailboxes inside Sparky's workspace:
 *   inbox/bonzai/<file>.md        device -> Sparky (Sparky reads with its normal file tools)
 *   outbox/bonzai/<device>/<file> Sparky -> device (acked files move to .read/)
 */
export class Mailbox {
  readonly inboxDir: string;
  readonly outboxDir: string;

  constructor(inboxDir: string, outboxDir: string) {
    this.inboxDir = inboxDir;
    this.outboxDir = outboxDir;
  }

  noteToSparky(device: Device, text: string): string {
    fs.mkdirSync(this.inboxDir, { recursive: true });
    const at = new Date().toISOString();
    const id = `${at.replace(/[:.]/g, '-')}-${device.id}-${randomBytes(2).toString('hex')}`;
    const body = [
      '---',
      `from: bonzai/${device.id}`,
      `label: ${device.label}`,
      `at: ${at}`,
      '---',
      '',
      text.trim(),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(this.inboxDir, `${id}.md`), body);
    return id;
  }

  private deviceOutbox(device: Device): string {
    return path.join(this.outboxDir, device.id);
  }

  read(device: Device, limit = 10): { messages: OutboxMessage[]; total: number } {
    const dir = this.deviceOutbox(device);
    if (!fs.existsSync(dir)) return { messages: [], total: 0 };
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.(md|txt)$/.test(e.name) && MESSAGE_ID.test(e.name))
      .map(e => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtime }))
      .sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
    const messages = files.slice(0, limit).map(f => {
      const text = fs.readFileSync(path.join(dir, f.name), 'utf8').trim();
      return {
        id: f.name,
        at: f.mtime.toISOString(),
        text: text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) + ' [truncated]' : text,
      };
    });
    return { messages, total: files.length };
  }

  /** Moves messages to .read/ instead of deleting them, so nothing is lost by a confused model. */
  ack(device: Device, ids: string[]): { acked: string[]; missing: string[] } {
    const dir = this.deviceOutbox(device);
    const readDir = path.join(dir, '.read');
    const acked: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const src = path.join(dir, id);
      if (!MESSAGE_ID.test(id) || path.dirname(src) !== dir || !fs.existsSync(src)) {
        missing.push(id);
        continue;
      }
      fs.mkdirSync(readDir, { recursive: true });
      fs.renameSync(src, path.join(readDir, id));
      acked.push(id);
    }
    return { acked, missing };
  }
}
