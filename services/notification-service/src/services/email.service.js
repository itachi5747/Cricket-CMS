const nodemailer = require('nodemailer');
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('email-service');

let transporter = null;

// ─────────────────────────────────────────
// createTransporter
// Called once during service startup.
// In development: uses Ethereal (a fake SMTP service that
// captures emails without sending them — perfect for testing).
// In production: uses the SMTP config from environment variables.
// ─────────────────────────────────────────
const createTransporter = async () => {
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    // Ethereal auto-creates a test account — no setup needed
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host:   'smtp.ethereal.email',
      port:   587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    logger.info('Email transporter ready (Ethereal test mode)', {
      user: testAccount.user,
      previewUrl: 'https://ethereal.email',
    });
  } else {
    // Production SMTP
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    // Verify SMTP connection on startup
    await transporter.verify();
    logger.info('Email transporter ready (SMTP production mode)');
  }
  return transporter;
};

// ─────────────────────────────────────────
// sendEmail
// Core email sending function.
// Returns the preview URL in development (Ethereal link to view the email).
// ─────────────────────────────────────────
const sendEmail = async ({ to, subject, html, text }) => {
  if (!transporter) {
    logger.warn('Email transporter not initialized — skipping email send');
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"Cricket CMS" <noreply@cricket-cms.com>',
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''), // strip HTML for text fallback
    });

    // In dev, log the Ethereal preview URL so you can see the email in browser
    if (process.env.NODE_ENV === 'development') {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        logger.info('Email sent (preview available)', {
          to,
          subject,
          previewUrl,
        });
      }
    } else {
      logger.info('Email sent', { to, subject, messageId: info.messageId });
    }

    return info;
  } catch (err) {
    logger.error('Email send failed', { to, subject, error: err.message });
    throw err;
  }
};

// ─────────────────────────────────────────
// buildHtmlEmail
// Produces a simple but clean HTML email body.
// In production you'd use a proper template engine
// but this keeps the service dependency-light.
// ─────────────────────────────────────────
const buildHtmlEmail = ({ title, message, actionUrl, actionLabel }) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body        { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .container  { max-width: 600px; margin: 30px auto; background: #ffffff;
                  border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header     { background: #1a472a; color: #ffffff; padding: 24px 32px; }
    .header h1  { margin: 0; font-size: 22px; }
    .body       { padding: 28px 32px; color: #333333; line-height: 1.6; }
    .body p     { margin: 0 0 16px; }
    .action     { text-align: center; margin: 24px 0; }
    .btn        { display: inline-block; background: #1a472a; color: #ffffff;
                  text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; }
    .footer     { background: #f8f8f8; padding: 16px 32px; font-size: 12px;
                  color: #999999; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏏 Cricket Management System</h1>
    </div>
    <div class="body">
      <p><strong>${title}</strong></p>
      <p>${message.replace(/\n/g, '<br/>')}</p>
      ${actionUrl ? `
      <div class="action">
        <a href="${actionUrl}" class="btn">${actionLabel || 'View Details'}</a>
      </div>` : ''}
    </div>
    <div class="footer">
      This is an automated message from Cricket CMS. Please do not reply.
    </div>
  </div>
</body>
</html>
`;

module.exports = { createTransporter, sendEmail, buildHtmlEmail };
