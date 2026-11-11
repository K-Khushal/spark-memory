/**
 * Workers Free allows 50 subrequests per invocation. The hourly cron stays
 * under that, and splits what it has so one job cannot spend the whole
 * allowance before the others start.
 */
export const CRON_SUBREQUESTS = 40;

export const CRON_JOBS = [
  "uploads",
  "accounts",
  "exports",
  "indexing",
] as const;

export type CronJob = (typeof CRON_JOBS)[number];

/** One invocation's storage and queue calls, shared fairly across the four jobs. */
export type CronCalls = {
  /** False once this job's share is spent. */
  take(job: CronJob): boolean;
  remaining(job: CronJob): number;
};

export function cronCalls(total = CRON_SUBREQUESTS): CronCalls {
  const share = Math.floor(total / CRON_JOBS.length);
  const left = Object.fromEntries(
    CRON_JOBS.map((job) => [job, share])
  ) as Record<CronJob, number>;
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
