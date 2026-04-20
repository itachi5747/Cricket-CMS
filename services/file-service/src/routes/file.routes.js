const { Router } = require('express');
const multer     = require('multer');
const {
  authenticateJWT,
  authorizeRole,
  validate,
  validateQuery,
  validateParams,
  ROLES,
} = require('@cricket-cms/shared');

const {
  uploadFileSchema,
  generateReportSchema,
  entityParamSchema,
  fileIdParamSchema,
  reportIdParamSchema,
  listReportsQuerySchema,
} = require('../validators/file.validators');

const {
  uploadFile,
  getFile,
  deleteFile,
  getEntityFiles,
  generateReport,
  getReportStatus,
  listReports,
} = require('../controllers/file.controller');

const router = Router();

// ─────────────────────────────────────────
// Multer — in-memory storage
// Files are buffered in RAM then uploaded to MinIO.
// memoryStorage is correct here because:
//   1. We don't want temp files on disk inside containers
//   2. Files are immediately passed to MinIO uploader
// The 50MB limit covers our largest allowed file type (reports).
// ─────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 }, // 50MB absolute max
});

// ── IMPORTANT: named routes before parameterized ones
// /reports, /entity must come before /:fileId
// ─────────────────────────────────────────

// ── Report routes ─────────────────────────
router.get('/reports',
  authenticateJWT,
  validateQuery(listReportsQuerySchema),
  listReports
);

router.post('/reports/generate',
  authenticateJWT,
  authorizeRole([ROLES.CHAIRMAN, ROLES.ACCOUNTANT, ROLES.COACH]),
  validate(generateReportSchema),
  generateReport
);

router.get('/reports/:reportId/status',
  authenticateJWT,
  validateParams(reportIdParamSchema),
  getReportStatus
);

// ── Entity files ──────────────────────────
router.get('/entity/:entityType/:entityId',
  authenticateJWT,
  validateParams(entityParamSchema),
  getEntityFiles
);

// ── File upload & management ──────────────
router.post('/upload',
  authenticateJWT,
  upload.single('file'),     // 'file' is the form field name
  validate(uploadFileSchema),
  uploadFile
);

router.get('/:fileId',
  authenticateJWT,
  validateParams(fileIdParamSchema),
  getFile
);

router.delete('/:fileId',
  authenticateJWT,
  validateParams(fileIdParamSchema),
  deleteFile
);

module.exports = router;
