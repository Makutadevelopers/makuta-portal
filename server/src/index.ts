// index.ts
// Express app entry point.
// Loads env (fail-fast), registers middleware, mounts routes, starts server.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

console.log('Imported routes:', { authRoutes, vendorRoutes });

const app = express();

// Global middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

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

// Error handler (must be after all routes)
app.use(errorHandler);

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

  app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

start();

export default app;
