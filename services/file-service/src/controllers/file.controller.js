const path   = require('path');
const {
  sendSuccess,
  sendCreated,
  sendAccepted,
  sendPaginated,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  getPaginationParams,
  createLogger,
  ROLES,
  EVENTS,
} = require('@cricket-cms/shared');

const { publishEvent } = require('@cricket-cms/shared').rabbitmq;
const FileModel        = require('../models/file.model');
const MinioConfig      = require('../config/minio');
const PdfService       = require('../services/pdf.service');

const logger = createLogger('file-controller');

// ─────────────────────────────────────────
// Allowed MIME types per file type
// Validated after multer parses the file
// ─────────────────────────────────────────
const ALLOWED_MIME_TYPES = {
  image:    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['application/pdf', 'application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'text/plain'],
  report:   ['application/pdf'],
};

const MAX_FILE_SIZES = {
  image:    5  * 1024 * 1024,  // 5 MB
  document: 20 * 1024 * 1024,  // 20 MB
  report:   50 * 1024 * 1024,  // 50 MB
};

// ─────────────────────────────────────────
// POST /api/v1/files/upload — any authenticated user
// Expects multipart/form-data with a 'file' field
// ─────────────────────────────────────────
const uploadFile = async (req, res, next) => {
  try {
    // multer attaches req.file when a file is present
    if (!req.file) {
      throw BadRequestError('No file provided. Send file in the "file" field of a multipart form.');
    }

    const { fileType, relatedEntityType, relatedEntityId, description, isPublic } = req.body;
    let { tags } = req.body;

    // Normalize tags — multer may send as string
    if (typeof tags === 'string') {
      tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    }

    // Validate MIME type matches declared fileType
    const allowedMimes = ALLOWED_MIME_TYPES[fileType] || [];
    if (!allowedMimes.includes(req.file.mimetype)) {
      throw BadRequestError(
        `Invalid file type. For ${fileType}, allowed types are: ${allowedMimes.join(', ')}`
      );
    }

    // Validate file size
    const maxSize = MAX_FILE_SIZES[fileType];
    if (req.file.size > maxSize) {
      throw BadRequestError(
        `File too large. Maximum size for ${fileType} is ${maxSize / (1024 * 1024)}MB`
      );
    }

    // Generate unique storage key and upload to MinIO
    const originalName = req.file.originalname;
    const storageKey   = MinioConfig.generateStorageKey('uploads', originalName);
    const bucket       = MinioConfig.BUCKETS.FILES;

    const storageUrl = await MinioConfig.uploadFile({
      bucket,
      key:         storageKey,
      buffer:      req.file.buffer,
      contentType: req.file.mimetype,
      metadata: {
        uploadedBy:  req.user.userId,
        originalName,
      },
    });

    // Save metadata to MongoDB
    const fileRecord = await FileModel.createFileRecord({
      fileName:      storageKey.split('/').pop(),
      originalName,
      fileType,
      mimeType:      req.file.mimetype,
      fileSize:      req.file.size,
      storageKey,
      storageBucket: bucket,
      storageUrl,
      uploadedBy:    req.user.userId,
      relatedTo: relatedEntityType ? {
        entityType: relatedEntityType,
        entityId:   relatedEntityId,
      } : undefined,
      isPublic: isPublic === 'true' || isPublic === true,
      metadata: {
        description: description || null,
        tags:        tags || [],
      },
    });

    logger.info('File uploaded', {
      fileId:    fileRecord._id,
      fileType,
      size:      req.file.size,
      uploadedBy:req.user.userId,
    });

    return sendCreated(res, {
      fileId:      fileRecord._id,
      fileName:    fileRecord.originalName,
      fileType:    fileRecord.fileType,
      mimeType:    fileRecord.mimeType,
      fileSize:    fileRecord.fileSize,
      storageUrl:  fileRecord.storageUrl,
    }, 'File uploaded successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/files/:fileId — any authenticated user
// Returns metadata + a short-lived signed download URL
// ─────────────────────────────────────────
const getFile = async (req, res, next) => {
  try {
    const { fileId } = req.params;

    const file = await FileModel.getFileById(fileId);
    if (!file) throw NotFoundError('File not found');

    // Generate a presigned download URL (valid for 1 hour)
    const downloadUrl = await MinioConfig.getPresignedUrl(
      file.storageBucket,
      file.storageKey,
      3600
    );

    return sendSuccess(res, {
      fileId:        file._id,
      fileName:      file.originalName,
      fileType:      file.fileType,
      mimeType:      file.mimeType,
      fileSize:      file.fileSize,
      downloadUrl,                    // Presigned URL — expires in 1 hour
      uploadedBy:    file.uploadedBy,
      relatedTo:     file.relatedTo,
      isPublic:      file.isPublic,
      description:   file.metadata?.description,
      tags:          file.metadata?.tags,
      createdAt:     file.createdAt,
    });

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// DELETE /api/v1/files/:fileId
// Uploader can delete their own files.
// Chairman can delete any file.
// ─────────────────────────────────────────
const deleteFile = async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const { userId, role } = req.user;

    const file = await FileModel.getFileById(fileId);
    if (!file) throw NotFoundError('File not found');

    // Authorization check
    if (role !== ROLES.CHAIRMAN && file.uploadedBy !== userId) {
      throw ForbiddenError('You can only delete your own files');
    }

    // Delete from MinIO storage
    await MinioConfig.deleteFile(file.storageBucket, file.storageKey);

    // Soft delete the MongoDB record
    if (role === ROLES.CHAIRMAN) {
      await FileModel.adminDeleteFile(fileId);
    } else {
      await FileModel.softDeleteFile(fileId, userId);
    }

    logger.info('File deleted', { fileId, deletedBy: userId });

    return sendSuccess(res, null, 'File deleted successfully');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/files/entity/:entityType/:entityId
// Returns all non-deleted files for a specific entity
// e.g. all files attached to player X
// ─────────────────────────────────────────
const getEntityFiles = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;

    const files = await FileModel.getFilesByEntity(entityType, entityId);

    return sendSuccess(res, files.map((f) => ({
      fileId:      f._id,
      fileName:    f.originalName,
      fileType:    f.fileType,
      mimeType:    f.mimeType,
      fileSize:    f.fileSize,
      storageUrl:  f.storageUrl,
      description: f.metadata?.description,
      tags:        f.metadata?.tags,
      createdAt:   f.createdAt,
    })));

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// POST /api/v1/files/reports/generate
// Starts async PDF generation.
// Returns 202 immediately with a reportId.
// Client polls GET /reports/:reportId/status.
// ─────────────────────────────────────────
const generateReport = async (req, res, next) => {
  try {
    const { reportType, reportName, parameters } = req.body;

    // Create a pending report record
    const reportRecord = await FileModel.createReportRecord({
      reportType,
      reportName,
      generatedBy: req.user.userId,
      parameters: {
        dateRange: parameters.dateRange
          ? { start: new Date(parameters.dateRange.start), end: new Date(parameters.dateRange.end) }
          : undefined,
        filters:  parameters.filters || {},
        season:   parameters.season,
        playerId: parameters.playerId,
      },
      status: 'generating',
    });

    logger.info('Report generation started', {
      reportId:   reportRecord._id,
      reportType,
      reportName,
      requestedBy:req.user.userId,
    });

    // ── Fire and forget — generate PDF in background ──
    // We respond immediately with 202 so the client isn't blocked.
    // The background job updates the record when done.
    setImmediate(async () => {
      try {
        // In production, you'd fetch real data from the relevant service.
        // Here we generate with placeholder data — Phase 10 (API Gateway)
        // will wire the real data fetching.
        const placeholderData = {
          summary: {
            totalIncome:   1500000,
            totalExpenses: 1050000,
            netResult:     450000,
            isProfit:      true,
          },
          incomeBreakdown:  { sponsorships: 1500000, otherIncome: 0 },
          expenseBreakdown: { travel: 300000, equipment: 100000, facilities: 50000 },
          salaryTotal:      600000,
          overall: { matchesPlayed: 20, totalRuns: 850, battingAverage: 52.43 },
          recentForm: { trend: 'Improving', last5Matches: [] },
          milestones: [],
          summaries: [],
        };

        // Generate the PDF buffer
        const pdfBuffer = await PdfService.generateReport({
          reportType,
          reportName,
          parameters,
          data: placeholderData,
        });

        // Upload to MinIO
        const storageKey = MinioConfig.generateStorageKey('reports', `${reportName}.pdf`);
        const storageUrl = await MinioConfig.uploadFile({
          bucket:      MinioConfig.BUCKETS.REPORTS,
          key:         storageKey,
          buffer:      pdfBuffer,
          contentType: 'application/pdf',
        });

        // Save file record for the generated PDF
        const fileRecord = await FileModel.createFileRecord({
          fileName:      storageKey.split('/').pop(),
          originalName:  `${reportName}.pdf`,
          fileType:      'report',
          mimeType:      'application/pdf',
          fileSize:      pdfBuffer.length,
          storageKey,
          storageBucket: MinioConfig.BUCKETS.REPORTS,
          storageUrl,
          uploadedBy:    req.user.userId,
          isPublic:      false,
        });

        // Generate presigned download URL
        const downloadUrl = await MinioConfig.getPresignedUrl(
          MinioConfig.BUCKETS.REPORTS, storageKey, 86400 // 24 hours
        );

        // Mark report as completed
        await FileModel.updateReportStatus(reportRecord._id, {
          status:  'completed',
          fileId:  fileRecord._id.toString(),
          fileUrl: downloadUrl,
        });

        // Notify user that report is ready
        await publishEvent(EVENTS.REPORT_GENERATED, {
          reportId:    reportRecord._id.toString(),
          reportName,
          reportType,
          downloadUrl,
          generatedBy: req.user.userId,
        }, { userId: req.user.userId, source: 'file-service' });

        logger.info('Report generated successfully', {
          reportId: reportRecord._id, reportType, size: pdfBuffer.length,
        });

      } catch (err) {
        logger.error('Report generation failed', {
          reportId: reportRecord._id, error: err.message,
        });
        await FileModel.updateReportStatus(reportRecord._id, {
          status:   'failed',
          errorMsg: err.message,
        });
      }
    });

    // Return 202 Accepted — generation is in progress
    return sendAccepted(res, {
      reportId: reportRecord._id,
      status:   'generating',
      message:  'Report generation started. Poll GET /reports/:reportId/status for progress.',
    }, 'Report generation started');

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/files/reports/:reportId/status
// Poll this until status = "completed"
// ─────────────────────────────────────────
const getReportStatus = async (req, res, next) => {
  try {
    const { reportId } = req.params;

    const report = await FileModel.getReportById(reportId);
    if (!report) throw NotFoundError('Report not found');

    // Only the report owner can check status
    if (report.generatedBy !== req.user.userId && req.user.role !== ROLES.CHAIRMAN) {
      throw ForbiddenError('You can only check your own reports');
    }

    const response = {
      reportId:   report._id,
      reportType: report.reportType,
      reportName: report.reportName,
      status:     report.status,
      createdAt:  report.createdAt,
    };

    if (report.status === 'completed') {
      // Regenerate presigned URL — the one stored in DB may have expired
      try {
        const fileRecord = await FileModel.getFileById(report.fileId);
        if (fileRecord) {
          response.downloadUrl = await MinioConfig.getPresignedUrl(
            fileRecord.storageBucket, fileRecord.storageKey, 3600
          );
          response.fileSize = fileRecord.fileSize;
        }
      } catch {
        response.downloadUrl = report.fileUrl; // fallback to stored URL
      }
    }

    if (report.status === 'failed') {
      response.error = report.errorMsg;
    }

    return sendSuccess(res, response);

  } catch (err) { next(err); }
};

// ─────────────────────────────────────────
// GET /api/v1/files/reports — list own reports
// ─────────────────────────────────────────
const listReports = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPaginationParams(req.query);
    const { reports, total } = await FileModel.getUserReports({
      userId: req.user.userId,
      limit,
      skip:   offset,
    });

    return sendPaginated(
      res,
      reports.map((r) => ({
        reportId:   r._id,
        reportType: r.reportType,
        reportName: r.reportName,
        status:     r.status,
        createdAt:  r.createdAt,
      })),
      { page, limit, total }
    );

  } catch (err) { next(err); }
};

module.exports = {
  uploadFile,
  getFile,
  deleteFile,
  getEntityFiles,
  generateReport,
  getReportStatus,
  listReports,
};
