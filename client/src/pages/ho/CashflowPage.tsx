import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { apiFetch } from '../../api/client';
import { Link } from 'react-router-dom';

interface CashflowRow {
  month: string;
  purpose: string;
  total_invoiced: number;
  total_paid: number;
  invoice_count: number;
}

export default function CashflowPage() {
  const { user, logout } = useAuth();
  const [rows, setRows] = useState<CashflowRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<CashflowRow[]>('/cashflow')
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Cashflow</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <Link to="/invoices" className="hover:text-blue-600">Invoices</Link>
        <Link to="/payment-aging" className="hover:text-blue-600">Payment Aging</Link>
        <Link to="/cashflow" className="font-semibold text-blue-600">Cashflow</Link>
        <Link to="/vendors" className="hover:text-blue-600">Vendors</Link>
        <Link to="/audit" className="hover:text-blue-600">Audit Trail</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Invoiced</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right"># Invoices</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{r.month}</td>
                    <td className="px-3 py-2">{r.purpose}</td>
                    <td className="px-3 py-2 text-right">{fmt(Number(r.total_invoiced))}</td>
                    <td className="px-3 py-2 text-right">{fmt(Number(r.total_paid))}</td>
                    <td className="px-3 py-2 text-right">{fmt(Number(r.total_invoiced) - Number(r.total_paid))}</td>
                    <td className="px-3 py-2 text-right">{r.invoice_count}</td>
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
