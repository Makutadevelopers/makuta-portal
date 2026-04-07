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
import auditRoutes from './routes/audit.routes';
import attachmentRoutes from './routes/attachment.routes';
import exportRoutes from './routes/export.routes';
import tallyRoutes from './routes/tally.routes';
import importRoutes from './routes/import.routes';
import cronRoutes from './routes/cron.routes';
import alertsRoutes from './routes/alerts.routes';

console.log('Imported routes:', { authRoutes, vendorRoutes });

const app = express();

// Global middleware
app.use(cors({
  origin: env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(helmet());
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
app.use('/api/audit', auditRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/tally', tallyRoutes);
app.use('/api/import', importRoutes);
app.use('/api/alerts', alertsRoutes);
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
  // Verify database connection
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
  });

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
