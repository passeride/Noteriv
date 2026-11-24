import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// S3-compatible object storage for attachments (Phase C3). Originally planned
// as MinIO, swapped to Garage (web/infra/docker-compose.dev.yml has the full
// story) after `minio/minio`/`bitnami/minio` both turned out to be gone from
// Docker Hub as of 2026-10-13. The app only ever talks the S3 API, so a
// future move to real S3/R2 needs no code change here beyond env vars.
const s3 = new S3Client({
  endpoint: process.env.ATTACHMENTS_S3_ENDPOINT ?? "http://127.0.0.1:59000",
  region: process.env.ATTACHMENTS_S3_REGION ?? "garage",
  forcePathStyle: true, // required by Garage/MinIO-style servers (no virtual-hosted buckets)
  credentials: {
    accessKeyId: process.env.ATTACHMENTS_S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.ATTACHMENTS_S3_SECRET_ACCESS_KEY ?? "",
  },
});

const BUCKET = process.env.ATTACHMENTS_S3_BUCKET ?? "noteriv-attachments";

// Attachment storage is limited per account by the owner's plan (lib/plans.ts, session 5.3), checked against the
// sum of Attachment.size rows before every upload. That is the real enforcement: the Garage cluster layout's declared
// capacity is only a load-balancing weight, not a write-rejecting limit.

export async function checkStorage(): Promise<{ configured: boolean; ok: boolean; endpoint: string; error?: string }> {
  const endpoint = process.env.ATTACHMENTS_S3_ENDPOINT ?? "http://127.0.0.1:59000 (mặc định)";
  const configured = !!process.env.ATTACHMENTS_S3_ENDPOINT && !!process.env.ATTACHMENTS_S3_ACCESS_KEY_ID;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }), { abortSignal: AbortSignal.timeout(4000) });
    return { configured, ok: true, endpoint };
  } catch (err) {
    return { configured, ok: false, endpoint, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
}

export function makeStorageKey(vaultId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return `${vaultId}/${randomUUID()}-${safe}`;
}

export async function putObject(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObjectStream(storageKey: string) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: storageKey }));
  return res.Body; // a Node.js Readable in the Node runtime
}

export async function deleteObject(storageKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: storageKey }));
}

/**
 * Removes the stored files of attachments whose DB rows are gone (vault or account deletion: the
 * rows vanish by cascade but the objects would otherwise stay in the bucket forever). Call it AFTER
 * the DB delete succeeded, with keys read BEFORE it: if it ran first and the delete then failed, the
 * user would keep rows pointing at missing files. Best effort: returns how many keys failed so the
 * caller can log it; an object-store hiccup must not turn a completed deletion into an error.
 */
export async function deleteObjectsBestEffort(storageKeys: string[]): Promise<number> {
  let failed = 0;
  for (let i = 0; i < storageKeys.length; i += 10) {
    const results = await Promise.allSettled(storageKeys.slice(i, i + 10).map(deleteObject));
    failed += results.filter((r) => r.status === "rejected").length;
  }
  return failed;
}
