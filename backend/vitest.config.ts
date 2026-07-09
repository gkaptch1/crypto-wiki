import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config();

// tests run against a separate database, migrated by test/global-setup.ts
const base = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/cryptowiki');
base.pathname = '/cryptowiki_test';

export default defineConfig({
  test: {
    env: { DATABASE_URL: base.toString() },
    globalSetup: './test/global-setup.ts',
    // all files share one database; don't run them concurrently
    fileParallelism: false,
  },
});
