import { useAuth } from '../../hooks/useAuth';
import { useAgingCalc } from '../../hooks/useAgingCalc';
import { Link } from 'react-router-dom';

export default function PaymentAging() {
  const { user, logout } = useAuth();
  const { withinTerms, overdue, loading } = useAgingCalc();

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  function renderTable(rows: typeof overdue, title: string, color: string) {
    return (
      <div className="mb-8">
        <h2 className={`text-lg font-semibold mb-3 ${color}`}>{title} ({rows.length})</h2>
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Invoice #</th>
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-left">Due Date</th>
                <th className="px-3 py-2 text-right">Days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.invoice_id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">{r.vendor_name}</td>
                  <td className="px-3 py-2">{r.invoice_no}</td>
                  <td className="px-3 py-2">{r.site}</td>
                  <td className="px-3 py-2 text-right">{fmt(Number(r.invoice_amount))}</td>
                  <td className="px-3 py-2 text-right">{fmt(Number(r.total_paid))}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmt(Number(r.balance))}</td>
                  <td className="px-3 py-2">{fmtDate(r.due_date)}</td>
                  <td className="px-3 py-2 text-right">
                    {r.overdue
                      ? <span className="text-red-600">{r.days_past_due}d overdue</span>
                      : <span className="text-green-600">{r.days_left}d left</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Payment Aging</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <Link to="/invoices" className="hover:text-blue-600">Invoices</Link>
        <Link to="/payment-aging" className="font-semibold text-blue-600">Payment Aging</Link>
        <Link to="/cashflow" className="hover:text-blue-600">Cashflow</Link>
        <Link to="/vendors" className="hover:text-blue-600">Vendors</Link>
        <Link to="/audit" className="hover:text-blue-600">Audit Trail</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <>
            {renderTable(overdue, 'Overdue', 'text-red-600')}
            {renderTable(withinTerms, 'Within Terms', 'text-green-600')}
          </>
        )}
      </main>
    </div>
  );
}
