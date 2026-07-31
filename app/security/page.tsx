import LegalPage from "@/components/legal-page";
import { getPublicRuntimeConfig } from "@/lib/public-config";
import { getRequestLocale } from "@/lib/request-locale";
export const dynamic = "force-dynamic";
export default async function Page() {
  return (
    <LegalPage
      kind="security"
      publicConfig={getPublicRuntimeConfig()}
      initialLocale={await getRequestLocale()}
    />
  );
}
