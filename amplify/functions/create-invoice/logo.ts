import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});

/**
 * Fetches a company logo from S3 and returns it as a Buffer.
 *
 * Returns null when:
 * - key or bucketName is missing / empty
 * - the object cannot be fetched (not found, permission error, etc.)
 *
 * Never throws — logo failure must not block PDF generation or invoice
 * creation.  A warning is logged so failures are observable in CloudWatch.
 */
export async function fetchLogoFromS3(
  key: string | null | undefined,
  bucketName: string | null | undefined,
): Promise<Buffer | null> {
  if (!key || !bucketName) return null;

  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucketName, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) return null;
    return Buffer.from(bytes);
  } catch (err) {
    console.warn(
      '[logo] Failed to fetch logo from S3:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
