import { and, desc, eq, sql } from "drizzle-orm";
import {
  FREE_ALLOWANCE,
  IMPORT_RESERVE,
  ImportBatch,
  ImportCreate,
  ImportEntry,
  isVideoUrl,
  normaliseUrl,
} from "@spark/core";
import type { Database } from "./client";
import { importJob, importItem, memory, memoryFile, usageDay } from "./schema";
import { deletionRequested, lockOwner } from "./owner";
import { takeDailyCapture, takeDailyKeep } from "./capture-allowance";

export type ImportJob = typeof importJob.$inferSelect;
/** One owner's durable, bounded import. No network calls while a transaction is open. */
export function openImports(db: Database, userId: string) {
  const owned = (id: string) =>
    and(eq(importJob.id, id), eq(importJob.userId, userId));
  const get = async (id: string) =>
    (await db.select().from(importJob).where(owned(id)))[0];
  return {
    get,
    async pendingImages(id: string) {
      const job = await get(id);
      if (!job || job.state !== "running") return [];
      const [usage] = await db
        .select({ captures: usageDay.captures })
        .from(usageDay)
        .where(
          and(
            eq(usageDay.userId, userId),
            sql`${usageDay.day} = (now() at time zone 'utc')::date`
          )
        );
      const remaining = Math.max(
        0,
        FREE_ALLOWANCE.capturesPerDay - IMPORT_RESERVE - (usage?.captures ?? 0)
      );
      const rows = await db
        .select({ input: importItem.input, existing: memory.id })
        .from(importItem)
        .leftJoin(
          memory,
          and(
            eq(memory.id, sql`(${importItem.input}->>'imageId')::uuid`),
            eq(memory.userId, userId)
          )
        )
        .leftJoin(
          memoryFile,
          and(
            eq(memoryFile.memoryId, memory.id),
            eq(memoryFile.role, "original")
          )
        )
        .where(
          and(
            eq(importItem.jobId, id),
            sql`${importItem.input} ? 'imageId'`,
            sql`${memoryFile.storedAt} is null`
          )
        )
        .orderBy(importItem.position)
        .limit(FREE_ALLOWANCE.capturesPerDay);
      let left = remaining;
      return rows.flatMap((r) =>
        "imageId" in r.input && (r.existing || left-- > 0)
          ? [r.input.imageId]
          : []
      );
    },
    async wakeImage(memoryId: string, now = new Date()) {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [job] = await tx
          .select({ id: importJob.id, availableAt: importJob.availableAt })
          .from(importJob)
          .innerJoin(
            importItem,
            and(
              eq(importItem.jobId, importJob.id),
              sql`${importItem.position} = ${importJob.done} + ${importJob.skipped}`
            )
          )
          .innerJoin(
            memory,
            and(
              eq(memory.id, memoryId),
              eq(memory.userId, userId),
              sql`${importItem.input}->>'imageId' = ${memory.id}::text`
            )
          )
          .innerJoin(
            memoryFile,
            and(
              eq(memoryFile.memoryId, memory.id),
              eq(memoryFile.role, "original"),
              sql`${memoryFile.storedAt} is not null`
            )
          )
          .where(
            and(
              eq(importJob.userId, userId),
              eq(importJob.state, "running"),
              eq(importJob.waitingImageId, memoryId)
            )
          )
          .for("update", { of: importJob });
        if (!job) return undefined;
        await tx
          .update(importJob)
          .set({ availableAt: now, waitingImageId: null, allowanceAt: null })
          .where(owned(job.id));
        return job.id;
      });
    },
    async latest() {
      const [job] = await db
        .select()
        .from(importJob)
        .where(eq(importJob.userId, userId))
        .orderBy(desc(importJob.createdAt))
        .limit(1);
      if (!job) return undefined;
      const [usage] = await db
        .select({ captures: usageDay.captures })
        .from(usageDay)
        .where(
          and(
            eq(usageDay.userId, userId),
            sql`${usageDay.day} = (now() at time zone 'utc')::date`
          )
        );
      const [head] = await db
        .select({ input: importItem.input })
        .from(importItem)
        .where(
          and(
            eq(importItem.jobId, job.id),
            eq(importItem.position, job.done + job.skipped)
          )
        );
      const waitingForAllowance =
        job.state === "running" &&
        (job.spread || (!!head && "imageId" in head.input)) &&
        (usage?.captures ?? 0) >=
          FREE_ALLOWANCE.capturesPerDay - IMPORT_RESERVE;
      return { ...job, waitingForAllowance };
    },
    async create(input: { id: string; total: number; spread: boolean }) {
      const data = ImportCreate.parse(input);
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        if (await deletionRequested(tx, userId)) return undefined;
        const active = await tx
          .select()
          .from(importJob)
          .where(
            and(
              eq(importJob.userId, userId),
              sql`${importJob.state} in ('loading','running','paused')`
            )
          );
        if (active.length)
          return active.find(
            (j) =>
              j.id === data.id &&
              j.total === data.total &&
              j.spread === data.spread
          );
        return (
          await tx
            .insert(importJob)
            .values({ ...data, userId })
            .onConflictDoNothing()
            .returning()
        )[0];
      });
    },
    async append(id: string, batch: { offset: number; items: ImportEntry[] }) {
      const data = ImportBatch.parse(batch);
      return db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(importJob)
          .where(owned(id))
          .for("update");
        if (
          !job ||
          job.state !== "loading" ||
          data.offset + data.items.length > job.total
        )
          return false;
        if (data.offset < job.loaded) {
          const rows = await tx
            .select()
            .from(importItem)
            .where(
              and(
                eq(importItem.jobId, id),
                sql`${importItem.position} >= ${data.offset} and ${importItem.position} < ${data.offset + data.items.length}`
              )
            )
            .orderBy(importItem.position);
          return (
            JSON.stringify(rows.map((r) => ImportEntry.parse(r.input))) ===
            JSON.stringify(data.items)
          );
        }
        if (data.offset !== job.loaded) return false;
        await tx.insert(importItem).values(
          data.items.map((input, i) => ({
            jobId: id,
            position: i + data.offset,
            input,
          }))
        );
        await tx
          .update(importJob)
          .set({ loaded: job.loaded + data.items.length })
          .where(owned(id));
        return true;
      });
    },
    async action(id: string, action: "start" | "pause" | "resume" | "cancel") {
      return db.transaction(async (tx) => {
        const [job] = await tx
          .select()
          .from(importJob)
          .where(owned(id))
          .for("update");
        if (!job || job.state === "done" || job.state === "cancelled")
          return false;
        const state =
          action === "cancel"
            ? "cancelled"
            : action === "pause"
              ? "paused"
              : "running";
        if (state === "running" && job.loaded !== job.total) return false;
        await tx
          .update(importJob)
          .set({
            state,
            ...(state === "running" && {
              availableAt: new Date(),
              waitingImageId: null,
              allowanceAt: null,
            }),
          })
          .where(owned(id));
        if (state === "cancelled")
          await tx.delete(importItem).where(eq(importItem.jobId, id));
        return true;
      });
    },
    async step(id: string, now = new Date(), lease?: string) {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [job] = await tx
          .select()
          .from(importJob)
          .where(owned(id))
          .for("update");
        if (
          !job ||
          job.state !== "running" ||
          (lease
            ? lease !== job.availableAt.toISOString()
            : job.availableAt > now &&
              !(job.allowanceAt && job.allowanceAt <= now)) ||
          (await deletionRequested(tx, userId))
        )
          return undefined;
        const nextLease = new Date(
          Math.max(now.getTime() + 60_000, job.availableAt.getTime() + 1)
        );
        if (job.allowanceAt && job.allowanceAt > now) {
          await tx
            .update(importJob)
            .set({ availableAt: nextLease })
            .where(owned(id));
          return {
            target: undefined,
            lease: nextLease.toISOString(),
            dueAt: job.allowanceAt.toISOString(),
          };
        }
        await tx
          .update(importJob)
          .set({
            availableAt: nextLease,
            waitingImageId: null,
            allowanceAt: null,
          })
          .where(owned(id));
        const position = job.done + job.skipped;
        const [item] = await tx
          .select()
          .from(importItem)
          .where(
            and(eq(importItem.jobId, id), eq(importItem.position, position))
          );
        if (!item) return undefined;
        const input = item.input;
        if ("imageId" in input) {
          const [file] = await tx
            .select({ id: memory.id })
            .from(memory)
            .innerJoin(memoryFile, eq(memoryFile.memoryId, memory.id))
            .where(
              and(
                eq(memory.id, input.imageId),
                eq(memory.userId, userId),
                eq(memoryFile.role, "original"),
                sql`${memoryFile.storedAt} is not null`
              )
            );
          if (!file) {
            const [usage] = await tx
              .select({ captures: usageDay.captures })
              .from(usageDay)
              .where(
                and(
                  eq(usageDay.userId, userId),
                  eq(usageDay.day, now.toISOString().slice(0, 10))
                )
              );
            await tx
              .update(importJob)
              .set({
                availableAt: new Date(now.getTime() + 15 * 60_000),
                waitingImageId: input.imageId,
              })
              .where(owned(id));
            if (
              (usage?.captures ?? 0) >=
              FREE_ALLOWANCE.capturesPerDay - IMPORT_RESERVE
            ) {
              const next = new Date(now);
              next.setUTCHours(24, 0, 0, 0);
              await tx
                .update(importJob)
                .set({ availableAt: next, allowanceAt: next })
                .where(owned(id));
              return {
                target: undefined,
                lease: next.toISOString(),
                dueAt: next.toISOString(),
              };
            }
            return undefined;
          }
          const done = job.done + 1;
          await tx
            .update(importJob)
            .set({
              done,
              ...(done + job.skipped === job.total && { state: "done" }),
            })
            .where(owned(id));
          await tx
            .delete(importItem)
            .where(
              and(eq(importItem.jobId, id), eq(importItem.position, position))
            );
          return done + job.skipped < job.total
            ? { lease: nextLease.toISOString(), target: undefined }
            : undefined;
        }
        const normalised = normaliseUrl(input.url)!;
        const [duplicate] = await tx
          .select({ id: memory.id })
          .from(memory)
          .where(
            and(
              eq(memory.userId, userId),
              eq(memory.sourceUrlNormalised, normalised)
            )
          );
        let target;
        let skipped = !!duplicate;
        if (!duplicate) {
          // Insert first: concurrent fresh Captures can win the canonical URL.
          const [created] = await tx
            .insert(memory)
            .values({
              userId,
              kind: isVideoUrl(input.url) ? "video" : "link",
              preservation: "reference_only",
              sourceUrl: input.url,
              sourceUrlNormalised: normalised,
              title: input.title,
              captureNote: input.captureNote,
              capturedAt: input.savedAt ? new Date(input.savedAt) : now,
              lastSavedAt: input.savedAt ? new Date(input.savedAt) : now,
              indexPriority: "background",
            })
            .onConflictDoNothing()
            .returning();
          skipped = !created;
          if (created) {
            const allowed = await takeDailyCapture(
              tx,
              userId,
              now.toISOString().slice(0, 10),
              FREE_ALLOWANCE.capturesPerDay - IMPORT_RESERVE
            );
            // A job that is not spread out keeps what is over today's Captures
            // (partly Indexed), up to today's keeps; the rest waits for tomorrow.
            const kept =
              !allowed &&
              !job.spread &&
              (await takeDailyKeep(tx, userId, now.toISOString().slice(0, 10)));
            if (!allowed && !kept) {
              await tx.delete(memory).where(eq(memory.id, created.id));
              const next = new Date(now);
              next.setUTCHours(24, 0, 0, 0);
              await tx
                .update(importJob)
                .set({ availableAt: next, allowanceAt: next })
                .where(owned(id));
              return {
                target: undefined,
                lease: next.toISOString(),
                dueAt: next.toISOString(),
              };
            }
            if (kept)
              await tx
                .update(memory)
                .set({ overAllowance: true, indexState: "searchable" })
                .where(eq(memory.id, created.id));
            else target = created;
          }
        }
        const done = job.done + (skipped ? 0 : 1),
          skipCount = job.skipped + (skipped ? 1 : 0);
        await tx
          .update(importJob)
          .set({
            done,
            skipped: skipCount,
            ...(done + skipCount === job.total && { state: "done" }),
          })
          .where(owned(id));
        await tx
          .delete(importItem)
          .where(
            and(eq(importItem.jobId, id), eq(importItem.position, position))
          );
        const continuation =
          done + skipCount < job.total ? nextLease.toISOString() : undefined;
        return target || continuation
          ? { target, lease: continuation }
          : undefined;
      });
    },
  };
}
/** Recovery pages for lost queue deliveries, ordered by stable IDs. */
export async function pendingImports(
  db: Database,
  limit = 100,
  now = new Date(),
  after?: string
) {
  return db
    .select({ id: importJob.id, userId: importJob.userId })
    .from(importJob)
    .where(
      and(
        eq(importJob.state, "running"),
        after ? sql`${importJob.id} > ${after}::uuid` : undefined,
        sql`(${importJob.allowanceAt} <= ${now} or (${importJob.allowanceAt} is null and
          (${importJob.waitingImageId} is null or exists (
          select 1 from memory_file f join memory m on m.id = f.memory_id
          where m.id = ${importJob.waitingImageId} and m.user_id = ${importJob.userId}
          and f.role = 'original' and f.stored_at is not null
        )) and ${importJob.availableAt} < ${new Date(now.getTime() - 10 * 60_000)}))`
      )
    )
    .orderBy(importJob.id)
    .limit(Math.max(0, Math.min(101, limit)));
}
