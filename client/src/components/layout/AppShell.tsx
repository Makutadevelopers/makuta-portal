import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const HO_TABS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/invoices', label: 'All Invoices' },
  { to: '/payment-aging', label: 'Payment Aging' },
  { to: '/cashflow', label: 'Cashflow' },
  { to: '/vendors', label: 'Vendor Master' },
  { to: '/audit', label: 'Audit Trail' },
  { to: '/bin', label: 'Bin' },
];

const MGMT_TABS = [
  { to: '/overview', label: 'Overview' },
  { to: '/vendor-aging', label: 'Vendor Aging' },
  { to: '/mgmt-cashflow', label: 'Cashflow' },
];

const SITE_TABS = [
  { to: '/my-invoices', label: 'My Invoices' },
  { to: '/site-expenditure', label: 'Expenditure' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  const role = user?.role;
  const tabs = role === 'ho' ? HO_TABS : role === 'mgmt' ? MGMT_TABS : SITE_TABS;
  const subtitle = role === 'ho' ? 'Head Office — Full Access'
    : role === 'mgmt' ? 'Management — Read Only'
      : `${user?.site ?? ''} — Site Portal`;

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) ?? '';
  const avatarBg = role === 'ho' ? 'bg-blue-50 text-blue-800'
    : role === 'mgmt' ? 'bg-purple-50 text-purple-800'
      : 'bg-green-50 text-green-800';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#1a3c5e] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-medium">M</span>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">Accounting Module</div>
            <div className="text-xs text-gray-500 truncate hidden sm:block">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium text-gray-900">{user?.name}</div>
            <div className="text-xs text-gray-500">{user?.title}</div>
          </div>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${avatarBg}`}>
            {initials}
          </div>
          <button
            onClick={logout}
            className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Role banners */}
      {role === 'site' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-1.5 text-xs text-amber-800">
          Viewing <strong>{user?.site}</strong> data only · <span className="hidden sm:inline">Enter invoices and attach documents · </span>Payment processing is handled by Head Office
        </div>
      )}
      {role === 'mgmt' && (
        <div className="bg-purple-50 border-b border-purple-200 px-4 sm:px-6 py-1.5 text-xs text-purple-800">
          Management view — read only · All data is live
        </div>
      )}

      {/* Nav — horizontally scrollable on mobile */}
      <nav className="bg-white border-b border-gray-100 px-4 sm:px-6 flex gap-1 overflow-x-auto scrollbar-hide">
        {tabs.map(t => (
          <Link
            key={t.to}
            to={t.to}
            className={`px-3 sm:px-4 py-3 text-sm border-b-2 whitespace-nowrap flex-shrink-0 ${
              location.pathname === t.to
                ? 'border-[#1a3c5e] font-medium text-[#1a3c5e]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* Content */}
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
