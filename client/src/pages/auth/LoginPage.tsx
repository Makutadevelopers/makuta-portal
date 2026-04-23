import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginApi } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';

const SHOW_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const DEMO_USERS = [
  { label: 'Raju S', tag: '(HO)', email: 'raju@makuta.in', password: 'ho123' },
  { label: 'Harsha', tag: '(MD)', email: 'harsha@makuta.in', password: 'md123' },
  { label: 'Ramana', tag: 'Nirvana', email: 'ramana@makuta.in', password: 'nv123' },
  { label: 'Veerandhar', tag: 'Taranga', email: 'veerandhar@makuta.in', password: 'tr123' },
  { label: 'Madhu', tag: 'Horizon', email: 'madhu@makuta.in', password: 'hz123' },
  { label: 'Madhu', tag: 'Green', email: 'madhu.gw@makuta.in', password: 'gw123' },
  { label: 'Ramana', tag: 'Aruna', email: 'ramana.aa@makuta.in', password: 'aa123' },
  { label: 'Thanug', tag: 'Office', email: 'thanug@makuta.in', password: 'of123' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await loginApi(email, password);
      setAuth(data);

      switch (data.user.role) {
        case 'ho':
          navigate('/dashboard');
          break;
        case 'mgmt':
          navigate('/overview');
          break;
        case 'site':
          navigate('/my-invoices');
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function autofill(u: typeof DEMO_USERS[number]) {
    setEmail(u.email);
    setPassword(u.password);
    setError('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
        {/* Logo */}
        <div className="text-center mb-7">
          <img
            src="/makuta-logo.jpeg"
            alt="Makuta Developers"
            className="w-24 h-24 mx-auto mb-3 object-contain"
          />
          <div className="text-sm text-gray-500">Accounting Module</div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="you@makuta.in"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#1a3c5e] text-white rounded-lg hover:bg-[#15304d] disabled:opacity-50 text-sm font-medium mt-1"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Demo credentials — only visible in development when VITE_DEMO_MODE=true */}
        {SHOW_DEMO && (
          <div className="mt-6 pt-5 border-t border-gray-100">
            <div className="text-xs font-medium text-gray-500 mb-3">Demo credentials — click to autofill</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              {DEMO_USERS.map(u => (
                <div
                  key={u.email}
                  onClick={() => autofill(u)}
                  className="flex items-center justify-between py-1.5 border-b border-gray-50 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
                >
                  <span className="text-xs text-gray-900">
                    {u.label}
                    <span className="text-gray-400 ml-1">{u.tag}</span>
                  </span>
                  <code className="text-[10px] text-gray-400">{u.password}</code>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
