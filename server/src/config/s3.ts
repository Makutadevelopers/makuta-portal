// s3.ts
// AWS S3 client for invoice attachment uploads/downloads.
// When AWS credentials are not set, s3 is null and uploads fall back to local disk.

import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

const hasS3 = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.S3_BUCKET_NAME);

export const s3: S3Client | null = hasS3
  ? new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    })
  : null;

export const S3_BUCKET = env.S3_BUCKET_NAME;
