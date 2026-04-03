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

const app = express();

// Global middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/invoices/:id/payments', paymentRoutes);
app.use('/api/invoices/:id/attachments', attachmentRoutes);
app.use('/api/aging', agingRoutes);
app.use('/api/cashflow', cashflowRoutes);
app.use('/api/audit', auditRoutes);

// Global error handler (must be last)
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
