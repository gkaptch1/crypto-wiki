import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config();

// tests run against a separate database, migrated by test/global-setup.ts
const base = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/cryptowiki');
base.pathname = '/cryptowiki_test';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: base.toString(),
      // hermetic auth config — don't inherit whatever backend/.env sets
      BETTER_AUTH_SECRET: 'vitest-only-secret-not-for-production',
      BETTER_AUTH_URL: 'http://localhost:3000',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      AUTH_PASSWORD_SIGNIN: '1',
      ADMIN_EMAILS: 'root@admin.test',
    },
    globalSetup: './test/global-setup.ts',
    // all files share one database; don't run them concurrently
    fileParallelism: false,
  },
});
