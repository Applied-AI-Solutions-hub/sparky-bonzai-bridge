// Manage the devices allowed to use the bridge.
//   npm run device -- add iphone --label Kit [--session mcp-kit-iphone]
//   npm run device -- list
//   npm run device -- remove iphone
import { loadConfig } from '../src/config.ts';
import { addDevice, listDevices, removeDevice } from '../src/devices.ts';

const { devicesFile, port } = loadConfig();
const [cmd, id, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function usage(): never {
  console.error('Usage: npm run device -- add <id> [--label <name>] [--session <openclaw-session-key>] | list | remove <id>');
  process.exit(2);
}

try {
  if (cmd === 'add' && id) {
    const token = addDevice(devicesFile, id, flag('--label') || id, flag('--session'));
    console.log(`Added device "${id}". Its token is shown once, so copy it now:\n`);
    console.log(`  ${token}\n`);
    console.log('In BonzAI > MCP servers, add:');
    console.log(`  URL:    https://<your-machine>.<tailnet>.ts.net:${port}/mcp`);
    console.log(`  Header: Authorization: Bearer ${token}`);
  } else if (cmd === 'list') {
    const devices = listDevices(devicesFile);
    if (!devices.length) console.log('No devices registered.');
    for (const d of devices) console.log(`${d.id}\t${d.label}\tsession=${d.sessionKey ?? `bonzai-${d.id}`}\tadded ${d.createdAt}`);
  } else if (cmd === 'remove' && id) {
    console.log(removeDevice(devicesFile, id) ? `Removed "${id}". Its token no longer works.` : `No device "${id}".`);
  } else usage();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
