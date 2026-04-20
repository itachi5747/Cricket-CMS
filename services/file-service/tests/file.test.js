require('dotenv').config({ path: `${__dirname}/../.env` });
const request = require('supertest');
const jwt     = require('jsonwebtoken');
const path    = require('path');

const JWT_SECRET = 'test_secret_key_minimum_32_chars_long!!';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV   = 'test';

const makeToken = (overrides = {}) =>
  jwt.sign(
    { userId: 'user-uuid-1', username: 'coach', email: 'coach@c.com', role: 'Coach', ...overrides },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

// ── Mocks ────────────────────────────────
jest.mock('@cricket-cms/shared', () => {
  const actual = jest.requireActual('@cricket-cms/shared');
  return {
    ...actual,
    mongodb: {
      connectMongo:        jest.fn().mockResolvedValue(true),
      testMongoConnection: jest.fn().mockResolvedValue(true),
      closeMongo:          jest.fn(),
    },
    rabbitmq: {
      connectRabbitMQ:        jest.fn().mockResolvedValue(true),
      testRabbitMQConnection: jest.fn().mockResolvedValue(true),
      closeRabbitMQ:          jest.fn(),
      publishEvent:           jest.fn().mockResolvedValue('event-id'),
    },
  };
});

jest.mock('../src/config/minio', () => ({
  BUCKETS:              { FILES: 'cricket-files', REPORTS: 'cricket-reports' },
  initMinio:            jest.fn().mockResolvedValue(true),
  testMinioConnection:  jest.fn().mockResolvedValue(true),
  uploadFile:           jest.fn().mockResolvedValue('http://minio:9000/cricket-files/uploads/2026/03/uuid.jpg'),
  getPresignedUrl:      jest.fn().mockResolvedValue('http://minio:9000/presigned-url?token=abc'),
  deleteFile:           jest.fn().mockResolvedValue(true),
  generateStorageKey:   jest.fn().mockReturnValue('uploads/2026/03/test-uuid.jpg'),
}));

jest.mock('../src/models/file.model');
jest.mock('../src/services/pdf.service', () => ({
  generateReport: jest.fn().mockResolvedValue(Buffer.from('fake-pdf-content')),
}));

const FileModel   = require('../src/models/file.model');
const MinioConfig = require('../src/config/minio');
const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const { createApp, notFoundHandler, errorHandler } = require('@cricket-cms/shared');
const fileRoutes = require('../src/routes/file.routes');

const buildApp = () => {
  const app = createApp('file-test');
  app.use('/api/v1/files', fileRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

// ─────────────────────────────────────────
describe('File Service — All Endpoints', () => {
  let app;

  beforeAll(() => { app = buildApp(); });
  beforeEach(() => jest.clearAllMocks());

  // ─── POST /upload ────────────────────────
  describe('POST /api/v1/files/upload', () => {

    it('201 — successfully uploads an image', async () => {
      const token = makeToken();
      FileModel.createFileRecord.mockResolvedValue({
        _id:          'file-mongo-id-1',
        originalName: 'test-image.jpg',
        fileType:     'image',
        mimeType:     'image/jpeg',
        fileSize:     102400,
        storageUrl:   'http://minio:9000/cricket-files/uploads/2026/03/test-uuid.jpg',
      });

      // Create a small fake file buffer (1x1 white pixel JPEG)
      const fakeImageBuffer = Buffer.from(
        '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
        'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
        'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
        'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAA' +
        'AAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAA' +
        'AAAA/9oADAMBAAIRAxEAPwCwABmX/9k=',
        'base64'
      );

      const res = await request(app)
        .post('/api/v1/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fakeImageBuffer, { filename: 'test-image.jpg', contentType: 'image/jpeg' })
        .field('fileType', 'image')
        .field('relatedEntityType', 'player')
        .field('relatedEntityId', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

      expect(res.status).toBe(201);
      expect(res.body.data.fileName).toBe('test-image.jpg');
      expect(MinioConfig.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'image/jpeg' })
      );
    });

    it('400 — no file provided', async () => {
      const token = makeToken();
      const res = await request(app)
        .post('/api/v1/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('fileType', 'image');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('No file provided');
    });

    it('401 — unauthenticated request rejected', async () => {
      const res = await request(app)
        .post('/api/v1/files/upload')
        .field('fileType', 'image');
      expect(res.status).toBe(401);
    });
  });

  // ─── GET /:fileId ────────────────────────
  describe('GET /api/v1/files/:fileId', () => {

    it('200 — returns file metadata with presigned download URL', async () => {
      const token = makeToken();
      FileModel.getFileById.mockResolvedValue({
        _id:          'file-mongo-id-1',
        originalName: 'test-image.jpg',
        fileType:     'image',
        mimeType:     'image/jpeg',
        fileSize:     102400,
        storageKey:   'uploads/2026/03/test-uuid.jpg',
        storageBucket:'cricket-files',
        storageUrl:   'http://minio:9000/cricket-files/uploads/2026/03/test-uuid.jpg',
        uploadedBy:   'user-uuid-1',
        relatedTo:    { entityType: 'player', entityId: 'player-uuid' },
        isPublic:     false,
        metadata:     { description: 'Profile photo', tags: ['profile'] },
        createdAt:    new Date(),
      });

      const res = await request(app)
        .get('/api/v1/files/file-mongo-id-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.fileName).toBe('test-image.jpg');
      expect(res.body.data.downloadUrl).toBe('http://minio:9000/presigned-url?token=abc');
      expect(MinioConfig.getPresignedUrl).toHaveBeenCalledTimes(1);
    });

    it('404 — file not found', async () => {
      const token = makeToken();
      FileModel.getFileById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/files/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /:fileId ─────────────────────
  describe('DELETE /api/v1/files/:fileId', () => {

    it('200 — uploader can delete their own file', async () => {
      const token = makeToken({ userId: 'owner-uuid' });
      FileModel.getFileById.mockResolvedValue({
        _id:          'file-id-1',
        uploadedBy:   'owner-uuid',   // same as token userId
        storageKey:   'uploads/2026/03/file.jpg',
        storageBucket:'cricket-files',
      });
      FileModel.softDeleteFile.mockResolvedValue({ _id: 'file-id-1', isDeleted: true });

      const res = await request(app)
        .delete('/api/v1/files/file-mongo-id-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(MinioConfig.deleteFile).toHaveBeenCalledTimes(1);
    });

    it('403 — cannot delete another user\'s file', async () => {
      const token = makeToken({ userId: 'other-user-uuid', role: 'Coach' });
      FileModel.getFileById.mockResolvedValue({
        _id:         'file-id-1',
        uploadedBy:  'owner-uuid', // different from token userId
        storageKey:  'uploads/2026/03/file.jpg',
        storageBucket:'cricket-files',
      });

      const res = await request(app)
        .delete('/api/v1/files/file-mongo-id-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(MinioConfig.deleteFile).not.toHaveBeenCalled();
    });

    it('200 — Chairman can delete any file', async () => {
      const token = makeToken({ userId: 'chairman-uuid', role: 'Chairman' });
      FileModel.getFileById.mockResolvedValue({
        _id:         'file-id-1',
        uploadedBy:  'some-other-user',
        storageKey:  'uploads/2026/03/file.jpg',
        storageBucket:'cricket-files',
      });
      FileModel.adminDeleteFile.mockResolvedValue({ _id: 'file-id-1', isDeleted: true });

      const res = await request(app)
        .delete('/api/v1/files/file-mongo-id-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(FileModel.adminDeleteFile).toHaveBeenCalledWith('file-mongo-id-1');
    });
  });

  // ─── POST /reports/generate ──────────────
  describe('POST /api/v1/files/reports/generate', () => {

    it('202 — Coach triggers async report generation', async () => {
      const token = makeToken({ role: 'Coach' });
      FileModel.createReportRecord.mockResolvedValue({
        _id:    'report-mongo-id-1',
        status: 'generating',
      });

      const res = await request(app)
        .post('/api/v1/files/reports/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reportType: 'performance',
          reportName: 'Player Performance Q1 2026',
          parameters: {
            dateRange: { start: '2026-01-01', end: '2026-03-31' },
            season:    '2025-2026',
          },
        });

      // Must be 202 Accepted — not 200 or 201
      expect(res.status).toBe(202);
      expect(res.body.data.reportId).toBeDefined();
      expect(res.body.data.status).toBe('generating');
    });

    it('403 — Player cannot generate reports', async () => {
      const token = makeToken({ role: 'Player' });
      const res = await request(app)
        .post('/api/v1/files/reports/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reportType: 'financial',
          reportName: 'Q1 Report',
          parameters: { dateRange: { start: '2026-01-01', end: '2026-03-31' } },
        });
      expect(res.status).toBe(403);
    });

    it('422 — missing required fields', async () => {
      const token = makeToken({ role: 'Coach' });
      const res = await request(app)
        .post('/api/v1/files/reports/generate')
        .set('Authorization', `Bearer ${token}`)
        .send({ reportType: 'performance' }); // missing reportName and parameters
      expect(res.status).toBe(422);
    });
  });

  // ─── GET /reports/:reportId/status ───────
  describe('GET /api/v1/files/reports/:reportId/status', () => {

    it('200 — returns generating status', async () => {
      const token = makeToken();
      FileModel.getReportById.mockResolvedValue({
        _id:         'report-id-1',
        reportType:  'performance',
        reportName:  'Q1 Performance',
        generatedBy: 'user-uuid-1', // same as token
        status:      'generating',
        createdAt:   new Date(),
      });

      const res = await request(app)
        .get('/api/v1/files/reports/report-id-1/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('generating');
    });

    it('200 — returns download URL when completed', async () => {
      const token = makeToken();
      FileModel.getReportById.mockResolvedValue({
        _id:         'report-id-1',
        reportType:  'performance',
        reportName:  'Q1 Performance',
        generatedBy: 'user-uuid-1',
        status:      'completed',
        fileId:      'file-mongo-id-1',
        fileUrl:     'http://minio/signed-url',
        createdAt:   new Date(),
      });
      FileModel.getFileById.mockResolvedValue({
        storageBucket: 'cricket-reports',
        storageKey:    'reports/2026/03/report.pdf',
        fileSize:      125000,
      });

      const res = await request(app)
        .get('/api/v1/files/reports/report-id-1/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('404 — report not found', async () => {
      const token = makeToken();
      FileModel.getReportById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/files/reports/nonexistent-report/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});
