import { useState, FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPasswordApi } from '../../api/auth';
import PasswordInput from '../../components/shared/PasswordInput';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const inputClass = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Reset link is missing or malformed. Request a new one.');
      return;
    }
    if (newPassword.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPasswordApi(token, newPassword);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
        <div className="text-center mb-7">
          <img src="/makuta-logo.jpeg" alt="Makuta Developers" className="w-20 h-20 mx-auto mb-3 object-contain" />
          <div className="text-sm font-medium text-gray-900">Set a new password</div>
        </div>

        {done ? (
          <div className="text-center">
            <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-lg text-sm">
              Password updated. Redirecting to sign in…
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
            )}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="new" className="block text-xs text-gray-500 mb-1">New password</label>
                <PasswordInput
                  id="new"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                  placeholder="At least 4 characters"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="confirm" className="block text-xs text-gray-500 mb-1">Confirm password</label>
                <PasswordInput
                  id="confirm"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Re-enter the new password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#1a3c5e] text-white rounded-lg hover:bg-[#15304d] disabled:opacity-50 text-sm font-medium mt-1"
              >
                {loading ? 'Updating…' : 'Update password'}
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
