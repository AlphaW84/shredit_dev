import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shredit",
    short_name: "Shredit",
    description: "Encrypted one-time plaintext notes. No account required.",
    start_url: "/",
    display: "standalone",
    background_color: "#141618",
    theme_color: "#141618",
    icons: [
      {
        src: "/shredit-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/shredit-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/shredit-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
