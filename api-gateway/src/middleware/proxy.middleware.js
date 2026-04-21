const { createProxyMiddleware } = require('http-proxy-middleware');
const { createLogger } = require('@cricket-cms/shared');

const logger = createLogger('proxy');

// ─────────────────────────────────────────
// createServiceProxy
// Returns a proxy middleware configured for a specific service.
//
// Key proxy behaviours:
//   changeOrigin: true    — rewrites the Host header to match the target
//   pathRewrite           — strips the gateway prefix before forwarding
//                           e.g. /api/v1/auth/login → /api/v1/auth/login
//                           (no rewrite needed since services use same path)
//   on.error              — catches service-down errors and returns clean JSON
//   on.proxyReq           — injects gateway-specific headers before forwarding
//   on.proxyRes           — logs the response for observability
// ─────────────────────────────────────────
const createServiceProxy = (service) => {
  return createProxyMiddleware({
    target:       service.url,
    changeOrigin: true,
    pathRewrite: (path, req) => {
    return req.baseUrl + path;
  },
    // Forward request body for POST/PUT (required for proxy to work with body-parser)
    selfHandleResponse: false,

    on: {
      // ── Before forwarding: inject gateway headers ──
      proxyReq: (proxyReq, req) => {
        // Inject user context headers (set by auth middleware earlier)
        if (req.headers['x-user-id']) {
          proxyReq.setHeader('x-user-id',       req.headers['x-user-id']);
          proxyReq.setHeader('x-user-role',     req.headers['x-user-role']);
          proxyReq.setHeader('x-user-email',    req.headers['x-user-email'] || '');
          proxyReq.setHeader('x-user-username', req.headers['x-user-username'] || '');
        }

        // Forward correlation ID for distributed tracing
        if (req.correlationId) {
          proxyReq.setHeader('x-correlation-id', req.correlationId);
        }

        // Identify the gateway as the request source
        proxyReq.setHeader('x-forwarded-by', 'api-gateway');
        proxyReq.setHeader('x-gateway-version', '1.0');

        logger.debug('Proxying request', {
          service:       service.name,
          method:        req.method,
          path:          req.path,
          correlationId: req.correlationId,
        });
      },

      // ── After receiving response: log timing ──
      proxyRes: (proxyRes, req) => {
        const statusCode = proxyRes.statusCode;
        const logLevel   = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'debug';

        logger[logLevel]('Proxy response', {
          service:       service.name,
          method:        req.method,
          path:          req.path,
          statusCode,
          correlationId: req.correlationId,
        });
      },

      // ── If the target service is unreachable ──
      error: (err, req, res) => {
        logger.error('Proxy error — service unavailable', {
          service:    service.name,
          error:      err.message,
          path:       req.path,
          method:     req.method,
        });

        // Return a clean JSON error instead of an HTML proxy error page
        if (!res.headersSent) {
          res.status(503).json({
            success: false,
            message: `Service temporarily unavailable: ${service.name}`,
            service: service.name,
          });
        }
      },
    },
  });
};

module.exports = { createServiceProxy };
