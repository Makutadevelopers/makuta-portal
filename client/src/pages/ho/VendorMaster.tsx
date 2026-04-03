import { useAuth } from '../../hooks/useAuth';
import { useVendors } from '../../hooks/useVendors';
import { Link } from 'react-router-dom';

export default function VendorMaster() {
  const { user, logout } = useAuth();
  const { vendors, loading } = useVendors();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Vendor Master</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-red-600 hover:underline">Logout</button>
        </div>
      </header>

      <nav className="bg-white border-b px-6 py-2 flex gap-4 text-sm">
        <Link to="/dashboard" className="hover:text-blue-600">Dashboard</Link>
        <Link to="/invoices" className="hover:text-blue-600">Invoices</Link>
        <Link to="/payment-aging" className="hover:text-blue-600">Payment Aging</Link>
        <Link to="/cashflow" className="hover:text-blue-600">Cashflow</Link>
        <Link to="/vendors" className="font-semibold text-blue-600">Vendors</Link>
        <Link to="/audit" className="hover:text-blue-600">Audit Trail</Link>
      </nav>

      <main className="p-6">
        {loading ? <p className="text-gray-500">Loading...</p> : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Vendor Name</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Payment Terms</th>
                  <th className="px-3 py-2 text-left">GSTIN</th>
                  <th className="px-3 py-2 text-left">Contact</th>
                  <th className="px-3 py-2 text-left">Phone</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{v.name}</td>
                    <td className="px-3 py-2">{v.category}</td>
                    <td className="px-3 py-2 text-right">{v.payment_terms} days</td>
                    <td className="px-3 py-2 font-mono text-xs">{v.gstin}</td>
                    <td className="px-3 py-2">{v.contact_name}</td>
                    <td className="px-3 py-2">{v.phone}</td>
                    <td className="px-3 py-2 text-gray-500">{v.notes}</td>
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
