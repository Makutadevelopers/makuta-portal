import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { Link } from 'react-router-dom';

export default function MgmtOverview() {
  const { user, logout } = useAuth();
  const { invoices, loading } = useInvoices();

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.invoice_amount), 0);
  const paid = invoices.filter((i) => i.payment_status === 'Paid');
  const unpaid = invoices.filter((i) => i.payment_status === 'Not Paid');

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Executive Overview</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name} (MD)</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/overview" className="font-semibold text-blue-600">Overview</Link>
        <Link to="/vendor-aging" className="hover:text-blue-600">Vendor Aging</Link>
        <Link to="/mgmt-cashflow" className="hover:text-blue-600">Cashflow</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg shadow p-5">
              <p className="text-sm text-gray-500">Total Invoiced</p>
              <p className="text-2xl font-bold">{fmt(totalInvoiced)}</p>
              <p className="text-xs text-gray-400">{invoices.length} invoices</p>
            </div>
            <div className="bg-white rounded-lg shadow p-5">
              <p className="text-sm text-gray-500">Paid</p>
              <p className="text-2xl font-bold text-green-600">{paid.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-5">
              <p className="text-sm text-gray-500">Unpaid</p>
              <p className="text-2xl font-bold text-red-600">{unpaid.length}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
