import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Bridge } from './bridge.ts';
import type { Config } from './config.ts';
import type { Device } from './devices.ts';
import type { Job } from './jobs.ts';
import { openclawHealthy } from './openclaw.ts';

// Descriptions are written for a small on-device model: short, literal, and
// explicit about when to use each tool.

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }],
});

function publicJob(job: Job) {
  return {
    job_id: job.id,
    status: job.status,
    question: job.question.length > 200 ? job.question.slice(0, 200) + '…' : job.question,
    ...(job.answer ? { answer: job.answer } : {}),
    ...(job.error ? { error: job.error } : {}),
    created_at: job.createdAt,
    ...(job.finishedAt ? { finished_at: job.finishedAt } : {}),
  };
}

export function registerTools(server: McpServer, bridge: Bridge, device: Device, cfg: Config): void {
  server.registerTool('sparky_ask', {
    title: 'Ask Sparky',
    description: [
      'Ask Sparky, the bigger AI on the home PC, to do something you cannot do on this phone:',
      `long research, anything needing ${cfg.ownerName}'s files, email, calendar, memory or projects, or a second opinion.`,
      'Returns {status:"answered", answer} or, if Sparky needs longer, {status:"working", job_id}.',
      'For "working", call sparky_job_result later. Write the question so it makes sense on its own.',
    ].join(' '),
    inputSchema: {
      question: z.string().trim().min(1).max(8000).describe('The complete request for Sparky, with any context he needs.'),
      background: z.boolean().default(false).describe('true = do not wait; return a job_id right away.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ question, background }) => text(await bridge.ask(device, question, background)));

  server.registerTool('sparky_job_result', {
    title: 'Get Sparky job result',
    description: 'Get the result of a sparky_ask job. Pass job_id, or leave it empty to list this device\'s 5 most recent jobs.',
    inputSchema: {
      job_id: z.string().max(40).optional().describe('The job_id returned by sparky_ask.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ job_id }) => {
    if (!job_id) return text({ jobs: bridge.jobs.list(device.id).map(publicJob) });
    const job = bridge.jobs.get(job_id);
    if (!job || job.device !== device.id) throw new Error(`No job "${job_id}" for this device. Call sparky_job_result with no job_id to list recent jobs.`);
    return text(publicJob(job));
  });

  server.registerTool('sparky_note', {
    title: 'Leave Sparky a note',
    description: 'Leave Sparky a note he will read later. Use for reminders, captured ideas, or things to handle when he is free. No reply is returned.',
    inputSchema: {
      text: z.string().trim().min(1).max(4000).describe('The note.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ text: note }) => text({ saved: true, note_id: bridge.mailbox.noteToSparky(device, note) }));

  server.registerTool('sparky_inbox', {
    title: 'Read messages from Sparky',
    description: 'Read messages Sparky left for this device (oldest first). After handling them, call sparky_inbox_ack with their ids.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => text(bridge.mailbox.read(device)));

  server.registerTool('sparky_inbox_ack', {
    title: 'Mark Sparky messages as read',
    description: 'Mark messages from sparky_inbox as read so they stop showing. Pass the ids exactly as sparky_inbox returned them.',
    inputSchema: {
      ids: z.array(z.string().max(128)).min(1).max(50).describe('Message ids from sparky_inbox.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ ids }) => text(bridge.mailbox.ack(device, ids)));

  server.registerTool('sparky_status', {
    title: 'Sparky status',
    description: 'Check whether Sparky is online, whether he is busy with a job for this device, and how many messages are waiting.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const running = bridge.jobs.running(device.id);
    return text({
      sparky: (await openclawHealthy(cfg.openclawBin)) ? 'online' : 'offline',
      device: device.id,
      busy_with_job: running?.id ?? null,
      inbox_waiting: bridge.mailbox.read(device, 0).total,
    });
  });
}
