import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type JobStatus = 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  device: string;
  status: JobStatus;
  question: string;
  answer?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

const JOB_ID = /^j-[a-z0-9]{6,20}$/;

/** One JSON file per job, so state survives restarts and is easy to inspect. */
export class JobStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private write(job: Job): void {
    const tmp = this.file(job.id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file(job.id));
  }

  create(device: string, question: string): Job {
    const id = 'j-' + Date.now().toString(36) + randomBytes(3).toString('hex');
    const job: Job = { id, device, status: 'running', question, createdAt: new Date().toISOString() };
    this.write(job);
    return job;
  }

  finish(id: string, result: { answer: string } | { error: string }): Job {
    const job = this.get(id);
    if (!job) throw new Error(`Job ${id} vanished before it finished.`);
    const done: Job = {
      ...job,
      ...result,
      status: 'answer' in result ? 'done' : 'failed',
      finishedAt: new Date().toISOString(),
    };
    this.write(done);
    return done;
  }

  get(id: string): Job | null {
    if (!JOB_ID.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Job;
    } catch {
      return null;
    }
  }

  list(device: string, limit = 5): Job[] {
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => this.get(f.slice(0, -5)))
      .filter((j): j is Job => j !== null && j.device === device)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  running(device: string): Job | null {
    return this.list(device, 50).find(j => j.status === 'running') ?? null;
  }

  /** Jobs left "running" by a previous process can never finish. */
  failOrphans(): number {
    let n = 0;
    for (const f of fs.readdirSync(this.dir).filter(f => f.endsWith('.json'))) {
      const job = this.get(f.slice(0, -5));
      if (job?.status === 'running') {
        this.finish(job.id, { error: 'The bridge restarted while Sparky was working. Ask again.' });
        n++;
      }
    }
    return n;
  }

  prune(maxAgeDays = 7): void {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    for (const f of fs.readdirSync(this.dir).filter(f => f.endsWith('.json'))) {
      const job = this.get(f.slice(0, -5));
      if (job && job.status !== 'running' && Date.parse(job.createdAt) < cutoff) fs.rmSync(this.file(job.id));
    }
  }
}
