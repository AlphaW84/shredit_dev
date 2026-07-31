import { getEnv } from "@/lib/config/env";
import { closeDatabase, getPool } from "@/lib/database/client";
import { noteStore } from "@/lib/note-store";

async function cleanupBatch(env: ReturnType<typeof getEnv>) {
  const expired = await noteStore.cleanupExpired(100);
  const tombstones = await noteStore.cleanupTombstones(
    env.IDEMPOTENCY_TOMBSTONE_RETENTION_DAYS,
  );
  console.log(
    `Cleaned ${expired.deleted} expired notes and ${tombstones} idempotency tombstones.`,
  );
}

async function main() {
  const env = getEnv();
  try {
    if (env.SHREDIT_LOCAL_EPHEMERAL) {
      await cleanupBatch(env);
    } else {
      const owner = await getPool().connect();
      let acquired = false;
      try {
        const ownership = await owner.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext('shredit:cleanup-job')) AS acquired",
        );
        acquired = ownership.rows[0]?.acquired === true;
        if (acquired) await cleanupBatch(env);
        else
          console.log(
            "Cleanup skipped because another worker owns the job lock.",
          );
      } finally {
        if (acquired) {
          await owner.query(
            "SELECT pg_advisory_unlock(hashtext('shredit:cleanup-job'))",
          );
        }
        owner.release();
      }
    }
  } finally {
    if (!env.SHREDIT_LOCAL_EPHEMERAL) await closeDatabase();
  }
}

void main().catch(() => {
  console.error("Expired-note cleanup failed.");
  process.exitCode = 1;
});
