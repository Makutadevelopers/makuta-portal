import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordApi } from '../../api/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPasswordApi(email);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
        <div className="text-center mb-7">
          <img src="/makuta-logo.jpeg" alt="Makuta Developers" className="w-20 h-20 mx-auto mb-3 object-contain" />
          <div className="text-sm font-medium text-gray-900">Reset password</div>
          <div className="text-xs text-gray-500 mt-1">Enter the email tied to your Makuta account</div>
        </div>

        {submitted ? (
          <div className="text-center">
            <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-lg text-sm">
              Your password reset request was received. The Managing Director has been notified
              and will share a temporary password with you shortly.
            </div>
            <p className="text-xs text-gray-500 mb-6">
              No email is sent. The MD will reach out via WhatsApp / phone with a one-time password.
            </p>
            <Link to="/login" className="text-sm text-[#1a3c5e] hover:underline">← Back to sign in</Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
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
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#1a3c5e] text-white rounded-lg hover:bg-[#15304d] disabled:opacity-50 text-sm font-medium mt-1"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <div className="text-center pt-2">
                <Link to="/login" className="text-xs text-gray-500 hover:underline">← Back to sign in</Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
