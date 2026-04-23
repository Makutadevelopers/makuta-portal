import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getAlerts, getAlertCount, resolveAlert, Alert } from '../../api/alerts';
import { getPendingCount } from '../../utils/offlineSync';

const HO_TABS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/invoices', label: 'All Invoices' },
  { to: '/payment-aging', label: 'Payment Aging' },
  { to: '/cashflow', label: 'Cashflow' },
  { to: '/vendors', label: 'Vendor Master' },
  { to: '/bank-reconciliation', label: 'Bank Reconsideration' },
  { to: '/audit', label: 'Audit Trail' },
  { to: '/bin', label: 'Bin' },
];

const MGMT_TABS = [
  { to: '/overview', label: 'Overview' },
  { to: '/vendor-aging', label: 'Vendor Aging' },
  { to: '/mgmt-cashflow', label: 'Cashflow' },
  { to: '/mgmt-bank-reconciliation', label: 'Bank Reconsideration' },
  { to: '/employees', label: 'Employees' },
];

const SITE_TABS = [
  { to: '/site-dashboard', label: 'Dashboard' },
  { to: '/my-invoices', label: 'My Invoices' },
  { to: '/site-expenditure', label: 'Expenditure' },
  { to: '/vendors', label: 'Vendor Master' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const role = user?.role;
  const tabs = role === 'ho' ? HO_TABS : role === 'mgmt' ? MGMT_TABS : SITE_TABS;
  const subtitle = role === 'ho' ? 'Head Office — Full Access'
    : role === 'mgmt' ? 'Management — Read Only'
      : `${user?.site ?? ''} — Site Portal`;

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) ?? '';
  const avatarBg = role === 'ho' ? 'bg-blue-50 text-blue-800'
    : role === 'mgmt' ? 'bg-purple-50 text-purple-800'
      : 'bg-green-50 text-green-800';

  // Online/offline state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    getPendingCount().then(setPendingSync).catch(() => {});
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  // Notification state (HO only)
  const [alertCount, setAlertCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const loadCount = useCallback(async () => {
    if (role !== 'ho') return;
    try {
      const { count } = await getAlertCount();
      setAlertCount(count);
    } catch { /* ignore */ }
  }, [role]);

  useEffect(() => {
    loadCount();
    // Refresh count every 60s
    const interval = setInterval(loadCount, 60_000);
    return () => clearInterval(interval);
  }, [loadCount]);

  async function handleBellClick() {
    if (showAlerts) {
      setShowAlerts(false);
      return;
    }
    setShowAlerts(true);
    setAlertsLoading(true);
    try {
      const data = await getAlerts();
      setAlerts(data);
    } catch {
      setAlerts([]);
    }
    setAlertsLoading(false);
  }

  async function handleResolve(id: string) {
    try {
      await resolveAlert(id);
      setAlerts(prev => prev.filter(a => a.id !== id));
      setAlertCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <img
            src="/makuta-logo.jpeg"
            alt="Makuta"
            className="w-9 h-9 rounded-lg object-contain flex-shrink-0 bg-white"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">
              <span className="sm:hidden">Makuta</span>
              <span className="hidden sm:inline">Accounting Module</span>
            </div>
            <div className="text-xs text-gray-500 truncate hidden sm:block">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {/* Notification bell — HO only */}
          {role === 'ho' && (
            <div className="relative">
              <button
                onClick={handleBellClick}
                className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700"
                title="Notifications"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {alertCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] px-1">
                    {alertCount > 99 ? '99+' : alertCount}
                  </span>
                )}
              </button>

              {/* Alert dropdown */}
              {showAlerts && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAlerts(false)} />
                  <div className="absolute right-0 top-10 z-50 w-80 sm:w-96 bg-white border border-gray-200 rounded-xl shadow-xl max-h-[70vh] overflow-y-auto">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-900">Notifications</div>
                      {alerts.length > 0 && (
                        <span className="text-xs text-gray-500">{alerts.length} unresolved</span>
                      )}
                    </div>
                    {alertsLoading ? (
                      <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
                    ) : alerts.length === 0 ? (
                      <div className="py-8 text-center text-sm text-gray-400">No alerts</div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {alerts.map(alert => (
                          <div key={alert.id} className="px-4 py-3 hover:bg-gray-50/50">
                            <div className="flex items-start gap-2">
                              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                                alert.alert_type === 'duplicate_invoice' ? 'bg-red-500' : 'bg-amber-500'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900">{alert.title}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{alert.message}</div>
                                <div className="flex items-center gap-3 mt-2">
                                  <span className="text-[10px] text-gray-400">
                                    {new Date(alert.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {alert.alert_type === 'duplicate_invoice' && alert.metadata && (
                                    <button
                                      onClick={() => {
                                        const meta = alert.metadata as Record<string, string>;
                                        const search = meta.vendorName || alert.title.match(/#(.+?)\s/)?.[1] || '';
                                        setShowAlerts(false);
                                        navigate(`/invoices?search=${encodeURIComponent(search)}`);
                                      }}
                                      className="text-[11px] text-purple-600 hover:underline font-medium"
                                    >
                                      View Duplicates
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleResolve(alert.id)}
                                    className="text-[11px] text-gray-400 hover:underline"
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

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

      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-2 text-xs text-red-800 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          You are offline — cached data is shown. Changes will sync when connectivity returns.
          {pendingSync > 0 && <span className="font-medium ml-1">({pendingSync} pending)</span>}
        </div>
      )}

      {/* Content */}
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  );
}
