const { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('minio');

let s3Client = null;

// ─────────────────────────────────────────
// Bucket names — separate buckets by content type
// keeps access control clean and makes lifecycle
// policies easier to manage
// ─────────────────────────────────────────
const BUCKETS = {
  FILES:   process.env.MINIO_BUCKET_FILES   || 'cricket-files',
  REPORTS: process.env.MINIO_BUCKET_REPORTS || 'cricket-reports',
};

// ─────────────────────────────────────────
// initMinio
// Creates the S3 client configured for MinIO
// and ensures both buckets exist.
// ─────────────────────────────────────────
const initMinio = async () => {
  s3Client = new S3Client({
    endpoint:        process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    region:          process.env.MINIO_REGION   || 'us-east-1',
    credentials: {
      accessKeyId:     process.env.MINIO_USER     || 'minioadmin',
      secretAccessKey: process.env.MINIO_PASSWORD || 'minioadmin123',
    },
    // Required for MinIO path-style URLs
    forcePathStyle: true,
  });

  // Create buckets if they don't already exist
  for (const [name, bucket] of Object.entries(BUCKETS)) {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      logger.debug(`Bucket exists: ${bucket}`);
    } catch {
      // Bucket doesn't exist — create it
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.info(`Bucket created: ${bucket}`);
    }
  }

  logger.info('MinIO initialized', { buckets: Object.values(BUCKETS) });
  return s3Client;
};

// ─────────────────────────────────────────
// uploadFile
// Uploads a buffer to MinIO and returns the storage key.
// The key is a path like "uploads/2026/03/profile-uuid.jpg"
// ─────────────────────────────────────────
const uploadFile = async ({ bucket, key, buffer, contentType, metadata = {} }) => {
  if (!s3Client) throw new Error('MinIO client not initialized');

  await s3Client.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
    Metadata:    metadata,
  }));

  // Return the full storage URL (internal MinIO URL)
  const endpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9000';
  return `${endpoint}/${bucket}/${key}`;
};

// ─────────────────────────────────────────
// getPresignedUrl
// Generates a temporary signed URL for downloading a file.
// The URL expires after `expiresIn` seconds (default 1 hour).
// This is more secure than making files permanently public.
// ─────────────────────────────────────────
const getPresignedUrl = async (bucket, key, expiresIn = 3600) => {
  if (!s3Client) throw new Error('MinIO client not initialized');

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn });
};

// ─────────────────────────────────────────
// deleteFile
// Removes a file from MinIO storage.
// MongoDB metadata is deleted separately by the controller.
// ─────────────────────────────────────────
const deleteFile = async (bucket, key) => {
  if (!s3Client) throw new Error('MinIO client not initialized');

  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

// ─────────────────────────────────────────
// generateStorageKey
// Builds a unique, organised storage path for each file.
// Format: "uploads/YYYY/MM/uuid.extension"
// Keeps storage organized and avoids filename collisions.
// ─────────────────────────────────────────
const generateStorageKey = (prefix, originalName) => {
  const { v4: uuidv4 } = require('uuid');
  const now       = new Date();
  const year      = now.getFullYear();
  const month     = String(now.getMonth() + 1).padStart(2, '0');
  const extension = originalName.split('.').pop()?.toLowerCase() || 'bin';
  const uniqueId  = uuidv4();
  return `${prefix}/${year}/${month}/${uniqueId}.${extension}`;
};

const testMinioConnection = async () => {
  if (!s3Client) throw new Error('MinIO client not initialized');
  await s3Client.send(new HeadBucketCommand({ Bucket: BUCKETS.FILES }));
};

module.exports = {
  BUCKETS,
  initMinio,
  uploadFile,
  getPresignedUrl,
  deleteFile,
  generateStorageKey,
  testMinioConnection,
};
