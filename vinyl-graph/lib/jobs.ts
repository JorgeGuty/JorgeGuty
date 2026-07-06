import type { JobStatus } from './types';

// In-memory job store (MVP). Survives across requests within one server
// process; a restart clears it, which is acceptable for local use.
const globalStore = globalThis as unknown as { __vinylJobs?: Map<string, JobStatus> };
const jobs: Map<string, JobStatus> = globalStore.__vinylJobs ?? new Map();
globalStore.__vinylJobs = jobs;

export function createJob(): JobStatus {
  const id = Math.random().toString(36).slice(2, 10);
  const job: JobStatus = {
    id,
    stage: 'subiendo',
    percent: 0,
    message: 'Recibiendo video…',
    discsFound: 0,
  };
  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<JobStatus>) {
  const job = jobs.get(id);
  if (job) Object.assign(job, patch);
}

export function getJob(id: string): JobStatus | undefined {
  return jobs.get(id);
}
