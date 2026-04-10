// env.ts
// Validates all required environment variables on startup using zod.
// Import { env } from this file — never read process.env directly elsewhere.

import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // Database (individual vars OR DATABASE_URL — Railway injects the latter)
  DB_HOST: z.string().default(''),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default(''),
  DB_USER: z.string().default(''),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // Email (optional — emails disabled if not set)
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('noreply@makutadevelopers.com'),

  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Cron secret for internal scheduled endpoints
  CRON_SECRET: z.string().default(''),

  // Database URL (Railway / managed DB providers inject this)
  DATABASE_URL: z.string().optional(),

  // AWS S3 (optional for testing — attachments saved to local disk if not set)
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET_NAME: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors;
  const formatted = Object.entries(errors)
    .map(([key, msgs]) => `  ${key}: ${(msgs ?? []).join(', ')}`)
    .join('\n');

  console.error('\n❌ Missing or invalid environment variables:\n');
  console.error(formatted);
  console.error('\nCheck your .env file against .env.example\n');
  process.exit(1);
}

export const env = parsed.data;

// ── Production safety checks ────────────────────────────────────────────
// When NODE_ENV=production, refuse to start with dev/placeholder values.
if (env.NODE_ENV === 'production') {
  const problems: string[] = [];

  if (env.JWT_SECRET.includes('replace_with') || env.JWT_SECRET.includes('dev_secret')) {
    problems.push('JWT_SECRET still uses a placeholder — generate a real secret with `openssl rand -hex 48`');
  }
  if (env.JWT_SECRET.length < 48) {
    problems.push('JWT_SECRET should be at least 48 characters for production');
  }
  if (env.AWS_ACCESS_KEY_ID === 'local_dev_key' || env.AWS_SECRET_ACCESS_KEY === 'local_dev_secret') {
    problems.push('AWS credentials are placeholders — set real keys so attachments go to S3 instead of local disk');
  }
  if (!env.DATABASE_URL && (env.DB_PASSWORD === 'localdevpassword' || env.DB_PASSWORD.length < 12)) {
    problems.push('DB_PASSWORD is weak or uses the local dev default');
  }
  if (!env.DATABASE_URL && !env.DB_SSL) {
    problems.push('DB_SSL should be true in production (RDS requires TLS)');
  }
  if (env.ALLOWED_ORIGINS.includes('localhost')) {
    problems.push('ALLOWED_ORIGINS contains localhost — set to the real frontend domain(s)');
  }
  if (!env.CRON_SECRET) {
    problems.push('CRON_SECRET is empty — scheduled jobs (overdue alerts) will not run');
  }

  if (problems.length > 0) {
    console.error('\n❌ Production startup blocked by unsafe configuration:\n');
    for (const p of problems) console.error(`  • ${p}`);
    console.error('\nFix these in your production .env before deploying.\n');
    process.exit(1);
  }
}

export type Env = z.infer<typeof envSchema>;
