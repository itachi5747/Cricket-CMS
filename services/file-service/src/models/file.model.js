const mongoose = require('mongoose');

// ─────────────────────────────────────────
// SCHEMA 1: files
// Metadata for every file stored in MinIO.
// The actual bytes live in MinIO — MongoDB
// only holds the pointers and context.
// ─────────────────────────────────────────
const fileSchema = new mongoose.Schema(
  {
    fileName:     { type: String, required: true },        // stored name (uuid-based)
    originalName: { type: String, required: true },        // original filename from user
    fileType:     {
      type: String,
      enum: ['document', 'image', 'report'],
      required: true,
    },
    mimeType:     { type: String, required: true },
    fileSize:     { type: Number, required: true },        // bytes
    storageKey:   { type: String, required: true },        // MinIO object key
    storageBucket:{ type: String, required: true },        // which MinIO bucket
    storageUrl:   { type: String },                        // direct URL (internal)
    uploadedBy:   { type: String, required: true, index: true }, // userId UUID

    // What this file is related to
    relatedTo: {
      entityType: { type: String, enum: ['player', 'match', 'team', 'expense', 'general'] },
      entityId:   { type: String },
    },

    isPublic:  { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false }, // soft delete
    metadata: {
      description: { type: String },
      tags:        { type: [String], default: [] },
    },
  },
  {
    timestamps: true,
    collection: 'files',
  }
);

fileSchema.index({ uploadedBy: 1, createdAt: -1 });
fileSchema.index({ 'relatedTo.entityType': 1, 'relatedTo.entityId': 1 });
fileSchema.index({ isDeleted: 1 });

// ─────────────────────────────────────────
// SCHEMA 2: generated_reports
// Tracks async PDF report generation jobs.
// status: generating → completed | failed
// ─────────────────────────────────────────
const generatedReportSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: ['financial', 'performance', 'attendance'],
      required: true,
    },
    reportName:  { type: String, required: true },
    generatedBy: { type: String, required: true, index: true }, // userId UUID
    parameters: {
      dateRange: {
        start: { type: Date },
        end:   { type: Date },
      },
      filters: { type: mongoose.Schema.Types.Mixed, default: {} },
      season:  { type: String },
      playerId:{ type: String },
    },
    status:   {
      type: String,
      enum: ['generating', 'completed', 'failed'],
      default: 'generating',
    },
    fileId:    { type: String },   // ID of the file record once complete
    fileUrl:   { type: String },   // signed download URL (short-lived)
    errorMsg:  { type: String },   // set if status = failed
    // Auto-delete report records after 90 days
    expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
  },
  {
    timestamps: true,
    collection: 'generated_reports',
  }
);

generatedReportSchema.index({ generatedBy: 1, createdAt: -1 });
generatedReportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const File            = mongoose.model('File',            fileSchema);
const GeneratedReport = mongoose.model('GeneratedReport', generatedReportSchema);

// ─────────────────────────────────────────
// FILE QUERIES
// ─────────────────────────────────────────

const createFileRecord = async (data) => File.create(data);

const getFileById = async (fileId) =>
  File.findOne({ _id: fileId, isDeleted: false }).lean();

const getFilesByEntity = async (entityType, entityId) =>
  File.find({
    'relatedTo.entityType': entityType,
    'relatedTo.entityId':   entityId,
    isDeleted: false,
  })
  .sort({ createdAt: -1 })
  .lean();

// Soft delete — keeps audit trail, just flags the record
const softDeleteFile = async (fileId, userId) =>
  File.findOneAndUpdate(
    { _id: fileId, uploadedBy: userId },
    { $set: { isDeleted: true } },
    { new: true }
  );

// Admin hard delete — Chairman can delete any file
const adminDeleteFile = async (fileId) =>
  File.findByIdAndUpdate(fileId, { $set: { isDeleted: true } }, { new: true });

// ─────────────────────────────────────────
// REPORT QUERIES
// ─────────────────────────────────────────

const createReportRecord = async (data) => GeneratedReport.create(data);

const getReportById = async (reportId) =>
  GeneratedReport.findById(reportId).lean();

const updateReportStatus = async (reportId, { status, fileId, fileUrl, errorMsg }) =>
  GeneratedReport.findByIdAndUpdate(
    reportId,
    { $set: { status, fileId, fileUrl, errorMsg } },
    { new: true }
  );

const getUserReports = async ({ userId, limit, skip }) =>
  Promise.all([
    GeneratedReport.find({ generatedBy: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    GeneratedReport.countDocuments({ generatedBy: userId }),
  ]).then(([reports, total]) => ({ reports, total }));

module.exports = {
  createFileRecord,
  getFileById,
  getFilesByEntity,
  softDeleteFile,
  adminDeleteFile,
  createReportRecord,
  getReportById,
  updateReportStatus,
  getUserReports,
};
