import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { Link } from 'react-router-dom';

export default function MyInvoices() {
  const { user, logout } = useAuth();
  const { invoices, loading } = useInvoices();

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">My Invoices — {user?.site}</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name} ({user?.site})</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/my-invoices" className="font-semibold text-blue-600">My Invoices</Link>
        <Link to="/site-expenditure" className="hover:text-blue-600">Expenditure</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Invoice #</th>
                  <th className="px-3 py-2 text-left">Purpose</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Pushed</th>
                  <th className="px-3 py-2 text-left">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{fmtDate(inv.invoice_date)}</td>
                    <td className="px-3 py-2">{inv.vendor_name}</td>
                    <td className="px-3 py-2">{inv.invoice_no}</td>
                    <td className="px-3 py-2">{inv.purpose}</td>
                    <td className="px-3 py-2 text-right">{fmt(Number(inv.invoice_amount))}</td>
                    <td className="px-3 py-2">{inv.pushed ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-gray-500">{inv.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* NOTE: No payment_status column — site role cannot see payment data */}
          </div>
        )}
      </main>
    </div>
  );
}
