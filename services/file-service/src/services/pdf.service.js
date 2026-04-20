const PDFDocument = require('pdfkit');
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('pdf-service');

// ─────────────────────────────────────────
// generatePDF
// Creates a PDF in memory as a Buffer.
// Returns the buffer — caller uploads it to MinIO.
// ─────────────────────────────────────────
const generatePDF = (builderFn) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];

    doc.on('data',  (chunk) => chunks.push(chunk));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      builderFn(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

// ─────────────────────────────────────────
// Shared layout helpers
// ─────────────────────────────────────────

// Draw the header bar present on every report page
const drawHeader = (doc, title, subtitle) => {
  // Green header bar
  doc.rect(0, 0, doc.page.width, 80).fill('#1a472a');

  doc.fillColor('#ffffff')
    .fontSize(20)
    .font('Helvetica-Bold')
    .text('🏏 Cricket Management System', 50, 20);

  doc.fontSize(12)
    .font('Helvetica')
    .text(title, 50, 46);

  doc.fillColor('#333333')
    .fontSize(10)
    .font('Helvetica')
    .text(`Generated: ${new Date().toLocaleString()}`, 50, 90);

  if (subtitle) {
    doc.text(subtitle, 50, 105);
  }

  doc.moveDown(2);
};

// Draw a horizontal divider line
const drawDivider = (doc) => {
  doc.moveTo(50, doc.y)
    .lineTo(doc.page.width - 50, doc.y)
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .stroke()
    .moveDown(0.5);
};

// Draw a simple key-value row
const drawRow = (doc, label, value, isAlternate = false) => {
  const y = doc.y;
  if (isAlternate) {
    doc.rect(50, y - 2, doc.page.width - 100, 18)
      .fill('#f5f5f5');
  }
  doc.fillColor('#666666').fontSize(9).font('Helvetica')
    .text(label, 55, y, { width: 200 });
  doc.fillColor('#111111').fontSize(9).font('Helvetica-Bold')
    .text(String(value ?? 'N/A'), 260, y);
  doc.moveDown(0.4);
};

// Format currency
const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);

// ─────────────────────────────────────────
// generateFinancialReport
// ─────────────────────────────────────────
const generateFinancialReport = async ({ reportName, parameters, data }) => {
  logger.info('Generating financial PDF report', { reportName });

  return generatePDF((doc) => {
    const { from, to } = parameters.dateRange || {};
    const subtitle = `Period: ${from || 'N/A'} to ${to || 'N/A'}`;

    drawHeader(doc, reportName, subtitle);

    // ── Summary section ──
    doc.fillColor('#1a472a').fontSize(14).font('Helvetica-Bold')
      .text('Financial Summary', 50, doc.y);
    doc.moveDown(0.5);
    drawDivider(doc);

    const summary = data?.summary || {};
    drawRow(doc, 'Total Income',    formatCurrency(summary.totalIncome),    false);
    drawRow(doc, 'Total Expenses',  formatCurrency(summary.totalExpenses),  true);
    drawRow(doc, 'Net Result',      formatCurrency(summary.netResult),      false);
    drawRow(doc, 'Profitable',      summary.isProfit ? 'Yes ✓' : 'No ✗',  true);

    doc.moveDown(1);

    // ── Income breakdown ──
    doc.fillColor('#1a472a').fontSize(12).font('Helvetica-Bold')
      .text('Income Breakdown', 50, doc.y);
    doc.moveDown(0.5);
    drawDivider(doc);

    const income = data?.incomeBreakdown || {};
    drawRow(doc, 'Sponsorships', formatCurrency(income.sponsorships), false);
    drawRow(doc, 'Other Income', formatCurrency(income.otherIncome),  true);

    doc.moveDown(1);

    // ── Expense breakdown ──
    doc.fillColor('#1a472a').fontSize(12).font('Helvetica-Bold')
      .text('Expense Breakdown', 50, doc.y);
    doc.moveDown(0.5);
    drawDivider(doc);

    const expenses = data?.expenseBreakdown || {};
    let alternate = false;
    for (const [category, amount] of Object.entries(expenses)) {
      drawRow(doc, category.charAt(0).toUpperCase() + category.slice(1), formatCurrency(amount), alternate);
      alternate = !alternate;
    }

    drawRow(doc, 'Salary Payments', formatCurrency(data?.salaryTotal), alternate);

    // ── Footer ──
    doc.fillColor('#999999').fontSize(8)
      .text('This is a system-generated report. For queries contact the Finance department.',
        50, doc.page.height - 60);
  });
};

// ─────────────────────────────────────────
// generatePerformanceReport
// ─────────────────────────────────────────
const generatePerformanceReport = async ({ reportName, parameters, data }) => {
  logger.info('Generating performance PDF report', { reportName });

  return generatePDF((doc) => {
    const season   = parameters.season || 'Current Season';
    const subtitle = `Season: ${season}`;

    drawHeader(doc, reportName, subtitle);

    const stats   = data?.overall || {};
    const form    = data?.recentForm || {};

    // ── Overall stats ──
    doc.fillColor('#1a472a').fontSize(14).font('Helvetica-Bold')
      .text('Overall Statistics', 50, doc.y);
    doc.moveDown(0.5);
    drawDivider(doc);

    drawRow(doc, 'Matches Played',      stats.matchesPlayed || 0,     false);
    drawRow(doc, 'Total Runs',          stats.totalRuns || 0,          true);
    drawRow(doc, 'Batting Average',     stats.battingAverage || 0,    false);
    drawRow(doc, 'Strike Rate',         stats.strikeRate || 0,         true);
    drawRow(doc, 'Total Wickets',       stats.totalWickets || 0,      false);
    drawRow(doc, 'Bowling Average',     stats.bowlingAverage || 0,     true);
    drawRow(doc, 'Economy Rate',        stats.economyRate || 0,       false);
    drawRow(doc, 'Catches',             stats.catches || 0,            true);
    drawRow(doc, 'Player of Match',     stats.playerOfMatchCount || 0,false);

    doc.moveDown(1);

    // ── Recent form ──
    doc.fillColor('#1a472a').fontSize(12).font('Helvetica-Bold')
      .text('Recent Form', 50, doc.y);
    doc.moveDown(0.5);
    drawDivider(doc);

    drawRow(doc, 'Trend', form.trend || 'N/A', false);

    const last5 = form.last5Matches || [];
    last5.forEach((match, i) => {
      drawRow(doc,
        `Match ${i + 1}: vs ${match.opponent || 'N/A'}`,
        `Runs: ${match.runs}, Wickets: ${match.wickets}, Rating: ${match.rating}/10`,
        i % 2 === 1
      );
    });

    // ── Milestones ──
    if (data?.milestones?.length) {
      doc.moveDown(1);
      doc.fillColor('#1a472a').fontSize(12).font('Helvetica-Bold')
        .text('Career Milestones', 50, doc.y);
      doc.moveDown(0.5);
      drawDivider(doc);

      data.milestones.forEach((m, i) => {
        drawRow(doc, m.type, `${m.value} — ${new Date(m.date).toLocaleDateString()}`, i % 2 === 1);
      });
    }
  });
};

// ─────────────────────────────────────────
// generateAttendanceReport
// ─────────────────────────────────────────
const generateAttendanceReport = async ({ reportName, parameters, data }) => {
  logger.info('Generating attendance PDF report', { reportName });

  return generatePDF((doc) => {
    const month    = parameters.filters?.month || 'N/A';
    const subtitle = `Month: ${month}`;

    drawHeader(doc, reportName, subtitle);

    doc.fillColor('#1a472a').fontSize(14).font('Helvetica-Bold')
      .text('Attendance Summary', 50, doc.y);
    doc.moveDown(0.5);
    drawDivider(doc);

    // Column headers
    doc.fillColor('#ffffff');
    doc.rect(50, doc.y, doc.page.width - 100, 20).fill('#1a472a');
    const headerY = doc.y + 4;
    doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
      .text('Player', 55, headerY)
      .text('Sessions', 230, headerY)
      .text('Present', 295, headerY)
      .text('Absent', 345, headerY)
      .text('Late', 395, headerY)
      .text('Rate %', 440, headerY);
    doc.moveDown(1.5);

    // Data rows
    const summaries = data?.summaries || [];
    summaries.forEach((s, i) => {
      const y = doc.y;
      if (i % 2 === 1) {
        doc.rect(50, y - 2, doc.page.width - 100, 16).fill('#f5f5f5');
      }
      doc.fillColor('#111111').fontSize(9).font('Helvetica')
        .text(s.fullName || 'Unknown',   55,  y, { width: 170 })
        .text(String(s.totalSessions || 0), 230, y)
        .text(String(s.presentCount  || 0), 295, y)
        .text(String(s.absentCount   || 0), 345, y)
        .text(String(s.lateCount     || 0), 395, y)
        .text(`${s.attendancePercentage || 0}%`, 440, y);
      doc.moveDown(0.5);

      // Add a new page if we're near the bottom
      if (doc.y > doc.page.height - 100) {
        doc.addPage();
        doc.moveDown(1);
      }
    });
  });
};

// ─────────────────────────────────────────
// generateReport — dispatcher
// Routes to the correct generator based on reportType
// ─────────────────────────────────────────
const generateReport = async ({ reportType, reportName, parameters, data }) => {
  switch (reportType) {
    case 'financial':
      return generateFinancialReport({ reportName, parameters, data });
    case 'performance':
      return generatePerformanceReport({ reportName, parameters, data });
    case 'attendance':
      return generateAttendanceReport({ reportName, parameters, data });
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
};

module.exports = { generateReport };
