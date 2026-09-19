import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// S3-compatible object storage (Railway bucket). Path-style is required for most
// S3-compatible endpoints (MinIO / Railway), not AWS's virtual-host style.
export const BUCKET = process.env.AWS_S3_BUCKET_NAME ?? "";

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.AWS_DEFAULT_REGION ?? "auto",
      endpoint: process.env.AWS_ENDPOINT_URL,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
      },
      forcePathStyle: true,
    });
  }
  return _s3;
}

export function storageConfigured(): boolean {
  return !!(BUCKET && process.env.AWS_ENDPOINT_URL && process.env.AWS_ACCESS_KEY_ID);
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** Fetch an object's bytes + content type, or null if missing. */
export async function getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) return null;
    const body = await res.Body.transformToByteArray();
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try { await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch { /* ignore */ }
}
