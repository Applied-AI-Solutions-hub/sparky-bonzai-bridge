#!/usr/bin/env node
// Stand-in for the `openclaw` CLI in tests.
//   FAKE_DELAY_MS  how long an agent turn takes (default 0)
//   FAKE_MODE      ok | fail | empty (default ok)
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = name => args[args.indexOf(name) + 1];

if (args[0] === 'health') {
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}

if (args[0] === 'agent') {
  const message = fs.readFileSync(opt('--message-file'), 'utf8');
  const question = message.split('\n').at(-1);
  setTimeout(() => {
    const mode = process.env.FAKE_MODE ?? 'ok';
    if (mode === 'fail') {
      console.error('gateway unreachable');
      process.exit(1);
    }
    const text = mode === 'empty' ? '' : `agent=${opt('--agent')} session=${opt('--session-key')} echo: ${question}`;
    console.log(JSON.stringify({ result: { payloads: [{ text }] } }));
  }, Number(process.env.FAKE_DELAY_MS ?? 0));
} else {
  console.error(`fake-openclaw: unsupported command ${args[0]}`);
  process.exit(2);
}
