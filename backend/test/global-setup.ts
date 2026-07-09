import { execSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';

const TEST_DB = 'cryptowiki_test';

export default async function setup() {
  dotenv.config();
  const base = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/cryptowiki');

  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  }
  await admin.end();

  const testUrl = new URL(base);
  testUrl.pathname = `/${TEST_DB}`;
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'inherit',
  });
}
