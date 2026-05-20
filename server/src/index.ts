// index.ts
// Express app entry point.
// Loads env (fail-fast), registers middleware, mounts routes, starts server.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { pool } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import vendorRoutes from './routes/vendor.routes';
import invoiceRoutes from './routes/invoice.routes';
import paymentRoutes from './routes/payment.routes';
import agingRoutes from './routes/aging.routes';
import cashflowRoutes from './routes/cashflow.routes';
import analyticsRoutes from './routes/analytics.routes';
import auditRoutes from './routes/audit.routes';
import attachmentRoutes from './routes/attachment.routes';
import exportRoutes from './routes/export.routes';
import tallyRoutes from './routes/tally.routes';
import importRoutes from './routes/import.routes';
import cronRoutes from './routes/cron.routes';
import alertsRoutes from './routes/alerts.routes';
import reconciliationRoutes from './routes/reconciliation.routes';
import userRoutes from './routes/user.routes';
import pettyCashRoutes from './routes/petty-cash.routes';
import creditNoteRoutes from './routes/credit-note.routes';
import creditNoteAttachmentRoutes from './routes/credit-note-attachment.routes';
import categoriesRoutes from './routes/categories.routes';
import banksRoutes from './routes/banks.routes';
import adminRoutes from './routes/admin.routes';
import cron from 'node-cron';

console.log('Imported routes:', { authRoutes, vendorRoutes });

const app = express();

// Global middleware
app.use(cors({
  origin: env.ALLOWED_ORIGINS === '*' ? true : env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
}));
// Allow the makuta-sales-crm dashboard to embed mgmt-role pages in iframes.
// Default helmet would set X-Frame-Options: DENY which blocks them entirely.
// Origins come from CRM_FRAME_ORIGINS env (comma-separated, validated in
// config/env.ts) — fall back is dev-only localhost:3500 so prod is locked
// down unless explicitly opened.
const crmFrameOrigins = env.CRM_FRAME_ORIGINS
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(helmet({
  frameguard: false, // X-Frame-Options is superseded by CSP frame-ancestors below
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'frame-ancestors': ["'self'", ...crmFrameOrigins],
    },
  },
}));
app.use(express.json({ limit: '2mb' }));

// Global rate limiter — 200 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Please try again later' },
}));

console.log('Setting up routes...');

// Health check
app.get('/api/health', (_req, res) => {
  console.log('Health endpoint called');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test route
app.get('/api/test', (_req, res) => {
  console.log('Test endpoint called');
  res.json({ message: 'API is working' });
});

console.log('Mounting auth routes...');
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/invoices/:id/attachments', attachmentRoutes);
app.use('/api/invoices/:id/payments', paymentRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/aging', agingRoutes);
app.use('/api/cashflow', cashflowRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/tally', tallyRoutes);
app.use('/api/import', importRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/petty-cash', pettyCashRoutes);
app.use('/api/credit-notes/:id/attachments', creditNoteAttachmentRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/banks', banksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);

// Error handler (must be after all routes)
app.use(errorHandler);

// Health check that verifies DB is alive
app.get('/api/health/db', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// Start server
async function start(): Promise<void> {
  // Start listening FIRST so Railway healthcheck can reach /api/health
  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
  });

  // Then verify database connection
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  // Schedule weekly overdue digest at 9:00 AM IST every Monday.
  // Site accountants get a digest scoped to their site; HO gets the rollup.
  const cronSecret = (env as Record<string, unknown>)['CRON_SECRET'] as string | undefined;
  if (cronSecret) {
    cron.schedule('0 9 * * 1', async () => {
      console.log('[cron] Running weekly overdue digest...');
      try {
        const res = await fetch(`http://localhost:${env.PORT}/api/cron/overdue-alert`, {
          method: 'POST',
          headers: { 'x-cron-secret': cronSecret },
        });
        const data = await res.json() as Record<string, unknown>;
        console.log('[cron] Overdue digest result:', data);
      } catch (err) {
        console.error('[cron] Overdue digest failed:', err);
      }
    }, { timezone: 'Asia/Kolkata' });
    console.log('Cron: weekly overdue digest scheduled at 9:00 AM IST every Monday');
  } else {
    console.log('Cron: CRON_SECRET not set, skipping scheduled jobs');
  }

  // Graceful shutdown
  function shutdown(signal: string): void {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed');
      pool.end().then(() => {
        console.log('Database pool closed');
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    });
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Catch unhandled errors to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

start();

export default app;
