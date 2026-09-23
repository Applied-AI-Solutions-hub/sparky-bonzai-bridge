import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { addDevice } from '../src/devices.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
beforeEach(async () => {
  delete process.env.FAKE_DELAY_MS;
  delete process.env.FAKE_MODE;
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

describe('http + auth', () => {
  test('healthz needs no token', async () => {
    const res = await fetch(h.url.replace('/mcp', '/healthz'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  test('rejects missing and wrong tokens', async () => {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    assert.equal((await fetch(h.url, init)).status, 401);
    const wrong = await fetch(h.url, { ...init, headers: { ...init.headers, Authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
  });

  test('accepts clients that only send Accept: application/json', async () => {
    const res = await fetch(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${h.tokens.iphone}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.tools.length, 6);
  });

  test('lists the six tools', async () => {
    const client = await h.connect(h.tokens.iphone);
    const names = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(names, ['sparky_ask', 'sparky_inbox', 'sparky_inbox_ack', 'sparky_job_result', 'sparky_note', 'sparky_status']);
  });
});

describe('sparky_ask', () => {
  test('answers inline, on the configured agent, in a per-device session', async () => {
    const client = await h.connect(h.tokens.iphone);
    const r = await h.call(client, 'sparky_ask', { question: 'what is on my calendar?' });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.status, 'answered');
    assert.equal(r.json.answer, 'agent=sparky-mobile session=bonzai-iphone echo: what is on my calendar?');
  });

  test('device identity comes from the token, not from input', async () => {
    const client = await h.connect(h.tokens.ipad);
    const r = await h.call(client, 'sparky_ask', { question: 'hi', device: 'iphone' });
    assert.match(r.json.answer, /session=bonzai-ipad/);
  });

  test('uses a device\'s custom session key when one is registered', async () => {
    const token = addDevice(h.cfg.devicesFile, 'legacy', 'Kit', 'mcp-kit-iphone');
    const client = await h.connect(token);
    const r = await h.call(client, 'sparky_ask', { question: 'still me?' });
    assert.match(r.json.answer, /session=mcp-kit-iphone /);
  });

  test('turns into a job when Sparky is slow, and the job finishes later', async () => {
    process.env.FAKE_DELAY_MS = '3000';
    const client = await h.connect(h.tokens.iphone);
    const r = await h.call(client, 'sparky_ask', { question: 'slow one' });
    assert.equal(r.json.status, 'working');

    const busy = await h.call(client, 'sparky_ask', { question: 'another' });
    assert.equal(busy.isError, true);
    assert.match(busy.text, /still working on job/);

    await h.bridge.idle();
    const done = await h.call(client, 'sparky_job_result', { job_id: r.json.job_id });
    assert.equal(done.json.status, 'done');
    assert.match(done.json.answer, /echo: slow one/);
  });

  test('background returns a job id immediately', async () => {
    process.env.FAKE_DELAY_MS = '500';
    const client = await h.connect(h.tokens.iphone);
    const r = await h.call(client, 'sparky_ask', { question: 'later', background: true });
    assert.equal(r.json.status, 'working');
    await h.bridge.idle();
    const list = await h.call(client, 'sparky_job_result');
    assert.equal(list.json.jobs[0].status, 'done');
  });

  test('reports OpenClaw failures as tool errors', async () => {
    process.env.FAKE_MODE = 'fail';
    const client = await h.connect(h.tokens.iphone);
    const r = await h.call(client, 'sparky_ask', { question: 'x' });
    assert.equal(r.isError, true);
    assert.match(r.text, /gateway unreachable/);
  });

  test('jobs are private to their device', async () => {
    const phone = await h.connect(h.tokens.iphone);
    const tablet = await h.connect(h.tokens.ipad);
    const r = await h.call(phone, 'sparky_ask', { question: 'mine' });
    const peek = await h.call(tablet, 'sparky_job_result', { job_id: r.json.job_id });
    assert.equal(peek.isError, true);
  });
});

describe('rate limit', () => {
  test('caps asks per device per hour', async () => {
    await h.close();
    h = await startHarness({ maxAsksPerHour: 2 });
    const client = await h.connect(h.tokens.iphone);
    await h.call(client, 'sparky_ask', { question: '1' });
    await h.call(client, 'sparky_ask', { question: '2' });
    const third = await h.call(client, 'sparky_ask', { question: '3' });
    assert.equal(third.isError, true);
    assert.match(third.text, /Hourly limit/);
  });
});

describe('mailboxes', () => {
  test('sparky_note writes a file into Sparky\'s inbox', async () => {
    const client = await h.connect(h.tokens.iphone);
    const r = await h.call(client, 'sparky_note', { text: 'buy fertilizer' });
    const file = path.join(h.cfg.sparkyInboxDir, `${r.json.note_id}.md`);
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /from: bonzai\/iphone/);
    assert.match(body, /label: Kit/);
    assert.match(body, /buy fertilizer/);
  });

  test('inbox shows only this device\'s messages; ack moves them to .read', async () => {
    const dir = path.join(h.cfg.outboxDir, 'iphone');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.md'), 'first');
    await sleep(20);
    fs.writeFileSync(path.join(dir, 'b.md'), 'second');
    fs.mkdirSync(path.join(h.cfg.outboxDir, 'ipad'), { recursive: true });
    fs.writeFileSync(path.join(h.cfg.outboxDir, 'ipad', 'c.md'), 'not yours');

    const client = await h.connect(h.tokens.iphone);
    const inbox = await h.call(client, 'sparky_inbox');
    assert.deepEqual(inbox.json.messages.map((m: any) => m.text), ['first', 'second']);

    const ack = await h.call(client, 'sparky_inbox_ack', { ids: ['a.md', '../ipad/c.md', 'nope.md'] });
    assert.deepEqual(ack.json.acked, ['a.md']);
    assert.deepEqual(ack.json.missing, ['../ipad/c.md', 'nope.md']);
    assert.ok(fs.existsSync(path.join(dir, '.read', 'a.md')));
    assert.ok(fs.existsSync(path.join(h.cfg.outboxDir, 'ipad', 'c.md')));

    const status = await h.call(client, 'sparky_status');
    assert.equal(status.json.sparky, 'online');
    assert.equal(status.json.inbox_waiting, 1);
  });
});
