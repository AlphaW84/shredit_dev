import NotePageClient from "@/components/note-page-client";
import { getPublicRuntimeConfig } from "@/lib/public-config";
import { getRequestLocale } from "@/lib/request-locale";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function NotePage() {
  return (
    <NotePageClient
      publicConfig={getPublicRuntimeConfig()}
      initialLocale={await getRequestLocale()}
    />
  );
}
