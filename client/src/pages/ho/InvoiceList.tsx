import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { pushInvoice } from '../../api/invoices';
import { Link } from 'react-router-dom';

export default function InvoiceList() {
  const { user, logout } = useAuth();
  const { invoices, loading, error, refresh } = useInvoices();

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  async function handlePush(id: string) {
    await pushInvoice(id);
    refresh();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Invoices</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <Link to="/invoices" className="font-semibold text-blue-600">Invoices</Link>
        <Link to="/payment-aging" className="hover:text-blue-600">Payment Aging</Link>
        <Link to="/cashflow" className="hover:text-blue-600">Cashflow</Link>
        <Link to="/vendors" className="hover:text-blue-600">Vendors</Link>
        <Link to="/audit" className="hover:text-blue-600">Audit Trail</Link>
      </nav>

      <main className="p-6">
        {loading && <p className="text-gray-500">Loading...</p>}
        {error && <p className="text-red-600">{error}</p>}
        {!loading && (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">SL</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-left">Invoice #</th>
                  <th className="px-3 py-2 text-left">Purpose</th>
                  <th className="px-3 py-2 text-left">Site</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Pushed</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{inv.sl_no}</td>
                    <td className="px-3 py-2">{fmtDate(inv.invoice_date)}</td>
                    <td className="px-3 py-2">{inv.vendor_name}</td>
                    <td className="px-3 py-2">{inv.invoice_no}</td>
                    <td className="px-3 py-2">{inv.purpose}</td>
                    <td className="px-3 py-2">{inv.site}</td>
                    <td className="px-3 py-2 text-right">{fmt(Number(inv.invoice_amount))}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        inv.payment_status === 'Paid' ? 'bg-green-100 text-green-700' :
                        inv.payment_status === 'Partial' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {inv.payment_status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{inv.pushed ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2">
                      {!inv.pushed && (
                        <button
                          onClick={() => handlePush(inv.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Push
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
