import { getEnv } from "@/lib/config/env";
import { closeDatabase } from "@/lib/database/client";
import { noteStore } from "@/lib/note-store";

async function main() {
  const env = getEnv();
  try {
    console.log(await noteStore.reconcile());
  } finally {
    if (!env.SHREDIT_LOCAL_EPHEMERAL) await closeDatabase();
  }
}

void main().catch(() => {
  console.error("Capacity reconciliation failed.");
  process.exitCode = 1;
});
