/**
 * Workers Free allows 50 subrequests per invocation. The hourly cron stays
 * under that, and splits what it has so one job cannot spend the whole
 * allowance before the others start.
 */
export const CRON_SUBREQUESTS = 40;

/**
 * How the 40 calls are split. Deletions and export cleanup are separate, so
 * a queue of deletions cannot spend the calls that remove expired objects.
 */
export const CRON_SHARES = {
  uploads: 6,
  accounts: 6,
  cleanup: 4,
  exports: 9,
  indexing: 10,
  imports: 1,
  deepFetch: 4,
} as const;

export const CRON_JOBS = [
  "uploads",
  "accounts",
  "cleanup",
  "exports",
  "indexing",
  "imports",
  "deepFetch",
] as const;

export type CronJob = (typeof CRON_JOBS)[number];

/** One invocation's storage and queue calls, shared across the cron jobs. */
export type CronCalls = {
  /** False once this job's share is spent. */
  take(job: CronJob): boolean;
  remaining(job: CronJob): number;
};

export function cronCalls(total = CRON_SUBREQUESTS): CronCalls {
  const left = {} as Record<CronJob, number>;
  let used = 0;
  for (const job of CRON_JOBS) {
    const n = Math.floor((CRON_SHARES[job] * total) / CRON_SUBREQUESTS);
    left[job] = n;
    used += n;
  }
  left.uploads += total - used;
  return {
    take(job) {
      if (left[job] <= 0) return false;
      left[job] -= 1;
      return true;
    },
    remaining(job) {
      return left[job];
    },
  };
}
