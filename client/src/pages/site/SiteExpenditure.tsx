import { useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useInvoices } from '../../hooks/useInvoices';
import { Link } from 'react-router-dom';

export default function SiteExpenditure() {
  const { user, logout } = useAuth();
  const { invoices, loading } = useInvoices();

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  // Group by purpose (category)
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const inv of invoices) {
      const existing = map.get(inv.purpose) || { count: 0, total: 0 };
      existing.count++;
      existing.total += Number(inv.invoice_amount);
      map.set(inv.purpose, existing);
    }
    return Array.from(map.entries())
      .map(([purpose, data]) => ({ purpose, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [invoices]);

  const grandTotal = invoices.reduce((s, i) => s + Number(i.invoice_amount), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Expenditure — {user?.site}</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name} ({user?.site})</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/my-invoices" className="hover:text-blue-600">My Invoices</Link>
        <Link to="/site-expenditure" className="font-semibold text-blue-600">Expenditure</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right"># Invoices</th>
                  <th className="px-3 py-2 text-right">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((row) => (
                  <tr key={row.purpose} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{row.purpose}</td>
                    <td className="px-3 py-2 text-right">{row.count}</td>
                    <td className="px-3 py-2 text-right">{fmt(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50 font-bold">
                  <td className="px-3 py-2">Grand Total</td>
                  <td className="px-3 py-2 text-right">{invoices.length}</td>
                  <td className="px-3 py-2 text-right">{fmt(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
            {/* NOTE: No payment data shown — site role restriction */}
          </div>
        )}
      </main>
    </div>
  );
}
