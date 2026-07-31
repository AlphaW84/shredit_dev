import HomePage from "@/components/home-page";
import { getPublicRuntimeConfig } from "@/lib/public-config";
import { getRequestLocale } from "@/lib/request-locale";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  return (
    <HomePage
      publicConfig={getPublicRuntimeConfig()}
      initialLocale={await getRequestLocale()}
    />
  );
}
