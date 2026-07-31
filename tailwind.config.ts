import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-text)",
        action: "var(--color-action)",
        focus: "var(--color-focus)",
      },
    },
  },
  plugins: [],
};

export default config;
