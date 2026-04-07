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

  // Database
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USER: z.string().min(1, 'DB_USER is required'),
  DB_PASSWORD: z.string().min(1, 'DB_PASSWORD is required'),
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

  // AWS S3
  AWS_REGION: z.string().min(1, 'AWS_REGION is required'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS_ACCESS_KEY_ID is required'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required'),
  S3_BUCKET_NAME: z.string().min(1, 'S3_BUCKET_NAME is required'),
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

export type Env = z.infer<typeof envSchema>;
