import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Device {
  id: string;
  label: string;
  tokenSha256: string;
  createdAt: string;
  /** OpenClaw session key for this device's turns. Defaults to bonzai-<id>. */
  sessionKey?: string;
}

interface DeviceFile {
  devices: Record<string, Omit<Device, 'id'>>;
}

export const DEVICE_ID = /^[a-z][a-z0-9-]{1,31}$/;

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

function readFile(file: string): DeviceFile {
  if (!fs.existsSync(file)) return { devices: {} };
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DeviceFile>;
  return { devices: data.devices ?? {} };
}

function writeFile(file: string, data: DeviceFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function listDevices(file: string): Device[] {
  return Object.entries(readFile(file).devices).map(([id, d]) => ({ id, ...d }));
}

/**
 * Resolve a device from an Authorization header. The device identity comes from
 * the token itself, so a caller cannot claim to be another device.
 */
export function authenticate(devices: Device[], header: string | undefined): Device | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m) return null;
  const presented = sha256(m[1]);
  let match: Device | null = null;
  for (const d of devices) {
    const stored = Buffer.from(d.tokenSha256, 'hex');
    if (stored.length === presented.length && timingSafeEqual(stored, presented)) match = d;
  }
  return match;
}

/** Register a device and return its plaintext token. Only the hash is stored. */
export function addDevice(file: string, id: string, label: string, sessionKey?: string): string {
  if (!DEVICE_ID.test(id)) throw new Error('Device id must be 2-32 chars: lowercase letters, digits, dashes, starting with a letter.');
  if (sessionKey !== undefined && !/^[\w:.-]{1,100}$/.test(sessionKey)) throw new Error('Session key may only contain letters, digits, _ : . -');
  const data = readFile(file);
  if (data.devices[id]) throw new Error(`Device "${id}" already exists. Remove it first to rotate its token.`);
  const token = randomBytes(32).toString('base64url');
  data.devices[id] = {
    label: label.trim() || id,
    tokenSha256: sha256(token).toString('hex'),
    createdAt: new Date().toISOString(),
    ...(sessionKey ? { sessionKey } : {}),
  };
  writeFile(file, data);
  return token;
}

export function removeDevice(file: string, id: string): boolean {
  const data = readFile(file);
  if (!data.devices[id]) return false;
  delete data.devices[id];
  writeFile(file, data);
  return true;
}
