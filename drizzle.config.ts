export default {
  schema: "./lib/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://shredit:shredit@127.0.0.1:5432/shredit",
  },
} as const;
