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
import VendorDetail from './pages/ho/VendorDetail';
import AuditTrail from './pages/ho/AuditTrail';
import Bin from './pages/ho/Bin';
import BankReconciliation from './pages/ho/BankReconciliation';
import PettyCash from './pages/ho/PettyCash';

// Mgmt pages
import MgmtOverview from './pages/mgmt/MgmtOverview';
import VendorAging from './pages/mgmt/VendorAging';
import MgmtCashflow from './pages/mgmt/MgmtCashflow';
import MgmtBankReconciliation from './pages/mgmt/MgmtBankReconciliation';
import EmployeeManagement from './pages/mgmt/EmployeeManagement';

// Site pages
import SiteDashboard from './pages/site/SiteDashboard';
import MyInvoices from './pages/site/MyInvoices';
import SiteExpenditure from './pages/site/SiteExpenditure';
import SitePettyCash from './pages/site/SitePettyCash';

// Shared pages
import CreditNotes from './pages/shared/CreditNotes';

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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RootRedirect />} />

        {/* HO routes */}
        <Route path="/dashboard" element={<ProtectedRoute allowed={['ho']}><Dashboard /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute allowed={['ho']}><InvoiceList /></ProtectedRoute>} />
        <Route path="/payment-aging" element={<ProtectedRoute allowed={['ho']}><PaymentAging /></ProtectedRoute>} />
        <Route path="/cashflow" element={<ProtectedRoute allowed={['ho']}><CashflowPage /></ProtectedRoute>} />
        <Route path="/vendors" element={<ProtectedRoute allowed={['ho', 'site']}><VendorMaster /></ProtectedRoute>} />
        <Route path="/vendors/:id" element={<ProtectedRoute allowed={['ho', 'mgmt']}><VendorDetail /></ProtectedRoute>} />
        <Route path="/audit" element={<ProtectedRoute allowed={['ho']}><AuditTrail /></ProtectedRoute>} />
        <Route path="/bin" element={<ProtectedRoute allowed={['ho', 'mgmt']}><Bin /></ProtectedRoute>} />
        <Route path="/bank-reconciliation" element={<ProtectedRoute allowed={['ho']}><BankReconciliation /></ProtectedRoute>} />
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
    </BrowserRouter>
  );
}
