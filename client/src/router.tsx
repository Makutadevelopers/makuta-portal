import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Role } from './types/user';

// Auth/login pages stay eagerly imported — they're tiny and on the critical
// first-paint path, so code-splitting them would only add a loading flash.
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import SsoHandoff from './pages/auth/SsoHandoff';
import ChangePasswordPage from './pages/shared/ChangePasswordPage';

// Every role page is lazy-loaded so the initial bundle no longer ships the
// whole app (and heavy deps like Recharts) up front. Each route downloads its
// own chunk on first visit, cutting time-to-interactive on login.
// HO pages
const Dashboard = lazy(() => import('./pages/ho/Dashboard'));
const InvoiceList = lazy(() => import('./pages/ho/InvoiceList'));
const PaymentAging = lazy(() => import('./pages/ho/PaymentAging'));
const CashflowPage = lazy(() => import('./pages/ho/CashflowPage'));
const Analytics = lazy(() => import('./pages/ho/Analytics'));
const VendorMaster = lazy(() => import('./pages/ho/VendorMaster'));
const VendorDetail = lazy(() => import('./pages/ho/VendorDetail'));
const BankMaster = lazy(() => import('./pages/ho/BankMaster'));
const AuditTrail = lazy(() => import('./pages/ho/AuditTrail'));
const Bin = lazy(() => import('./pages/ho/Bin'));
const BankReconciliation = lazy(() => import('./pages/ho/BankReconciliation'));
const PettyCash = lazy(() => import('./pages/ho/PettyCash'));

// Mgmt pages
const MgmtOverview = lazy(() => import('./pages/mgmt/MgmtOverview'));
const VendorAging = lazy(() => import('./pages/mgmt/VendorAging'));
const MgmtCashflow = lazy(() => import('./pages/mgmt/MgmtCashflow'));
const MgmtBankReconciliation = lazy(() => import('./pages/mgmt/MgmtBankReconciliation'));
const EmployeeManagement = lazy(() => import('./pages/mgmt/EmployeeManagement'));

// Site pages
const SiteDashboard = lazy(() => import('./pages/site/SiteDashboard'));
const MyInvoices = lazy(() => import('./pages/site/MyInvoices'));
const SiteExpenditure = lazy(() => import('./pages/site/SiteExpenditure'));
const SitePettyCash = lazy(() => import('./pages/site/SitePettyCash'));

// Shared pages
const CreditNotes = lazy(() => import('./pages/shared/CreditNotes'));

function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#1a3c5e]" />
    </div>
  );
}

function ProtectedRoute({ children, allowed }: { children: React.ReactNode; allowed: Role[] }) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user || !allowed.includes(user.role)) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function RootRedirect() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  switch (user?.role) {
    case 'ho':
      return <Navigate to="/dashboard" replace />;
    case 'mgmt':
      return <Navigate to="/overview" replace />;
    case 'site':
      return <Navigate to="/site-dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso" element={<SsoHandoff />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/change-password" element={<ProtectedRoute allowed={['ho', 'mgmt', 'site']}><ChangePasswordPage /></ProtectedRoute>} />
        <Route path="/" element={<RootRedirect />} />

        {/* HO routes */}
        <Route path="/dashboard" element={<ProtectedRoute allowed={['ho']}><Dashboard /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute allowed={['ho']}><InvoiceList /></ProtectedRoute>} />
        <Route path="/payment-aging" element={<ProtectedRoute allowed={['ho']}><PaymentAging /></ProtectedRoute>} />
        <Route path="/cashflow" element={<ProtectedRoute allowed={['ho']}><CashflowPage /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute allowed={['ho', 'mgmt']}><Analytics /></ProtectedRoute>} />
        <Route path="/vendors" element={<ProtectedRoute allowed={['ho', 'site']}><VendorMaster /></ProtectedRoute>} />
        <Route path="/vendors/:id" element={<ProtectedRoute allowed={['ho', 'mgmt', 'site']}><VendorDetail /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute allowed={['ho', 'mgmt']}><AuditTrail /></ProtectedRoute>} />
        <Route path="/bin" element={<ProtectedRoute allowed={['ho', 'mgmt']}><Bin /></ProtectedRoute>} />
        <Route path="/bank-reconciliation" element={<ProtectedRoute allowed={['ho']}><BankReconciliation /></ProtectedRoute>} />
        <Route path="/banks" element={<ProtectedRoute allowed={['ho']}><BankMaster /></ProtectedRoute>} />
        <Route path="/petty-cash" element={<ProtectedRoute allowed={['ho']}><PettyCash /></ProtectedRoute>} />

        {/* Mgmt routes */}
        <Route path="/overview" element={<ProtectedRoute allowed={['mgmt']}><MgmtOverview /></ProtectedRoute>} />
        <Route path="/vendor-aging" element={<ProtectedRoute allowed={['mgmt']}><VendorAging /></ProtectedRoute>} />
        <Route path="/mgmt-cashflow" element={<ProtectedRoute allowed={['mgmt']}><MgmtCashflow /></ProtectedRoute>} />
        <Route path="/mgmt-bank-reconciliation" element={<ProtectedRoute allowed={['mgmt']}><MgmtBankReconciliation /></ProtectedRoute>} />
        <Route path="/employees" element={<ProtectedRoute allowed={['mgmt']}><EmployeeManagement /></ProtectedRoute>} />

        {/* Site routes */}
        <Route path="/site-dashboard" element={<ProtectedRoute allowed={['site']}><SiteDashboard /></ProtectedRoute>} />
        <Route path="/my-invoices" element={<ProtectedRoute allowed={['site']}><MyInvoices /></ProtectedRoute>} />
        <Route path="/site-expenditure" element={<ProtectedRoute allowed={['site']}><SiteExpenditure /></ProtectedRoute>} />
        <Route path="/site-petty-cash" element={<ProtectedRoute allowed={['site']}><SitePettyCash /></ProtectedRoute>} />

        {/* Shared: Credit Notes (ho + site entry, mgmt view-only) */}
        <Route path="/credit-notes" element={<ProtectedRoute allowed={['ho', 'site', 'mgmt']}><CreditNotes /></ProtectedRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
