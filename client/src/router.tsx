import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Role } from './types/user';
import LoginPage from './pages/auth/LoginPage';

// HO pages
import Dashboard from './pages/ho/Dashboard';
import InvoiceList from './pages/ho/InvoiceList';
import PaymentAging from './pages/ho/PaymentAging';
import CashflowPage from './pages/ho/CashflowPage';
import VendorMaster from './pages/ho/VendorMaster';
import AuditTrail from './pages/ho/AuditTrail';

// Mgmt pages
import MgmtOverview from './pages/mgmt/MgmtOverview';
import VendorAging from './pages/mgmt/VendorAging';
import MgmtCashflow from './pages/mgmt/MgmtCashflow';

// Site pages
import MyInvoices from './pages/site/MyInvoices';
import SiteExpenditure from './pages/site/SiteExpenditure';

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
      return <Navigate to="/my-invoices" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RootRedirect />} />

        {/* HO routes */}
        <Route path="/dashboard" element={<ProtectedRoute allowed={['ho']}><Dashboard /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute allowed={['ho']}><InvoiceList /></ProtectedRoute>} />
        <Route path="/payment-aging" element={<ProtectedRoute allowed={['ho']}><PaymentAging /></ProtectedRoute>} />
        <Route path="/cashflow" element={<ProtectedRoute allowed={['ho']}><CashflowPage /></ProtectedRoute>} />
        <Route path="/vendors" element={<ProtectedRoute allowed={['ho']}><VendorMaster /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute allowed={['ho']}><AuditTrail /></ProtectedRoute>} />

        {/* Mgmt routes */}
        <Route path="/overview" element={<ProtectedRoute allowed={['mgmt']}><MgmtOverview /></ProtectedRoute>} />
        <Route path="/vendor-aging" element={<ProtectedRoute allowed={['mgmt']}><VendorAging /></ProtectedRoute>} />
        <Route path="/mgmt-cashflow" element={<ProtectedRoute allowed={['mgmt']}><MgmtCashflow /></ProtectedRoute>} />

        {/* Site routes */}
        <Route path="/my-invoices" element={<ProtectedRoute allowed={['site']}><MyInvoices /></ProtectedRoute>} />
        <Route path="/site-expenditure" element={<ProtectedRoute allowed={['site']}><SiteExpenditure /></ProtectedRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
