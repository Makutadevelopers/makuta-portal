import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePasswordApi } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import PasswordInput from '../../components/shared/PasswordInput';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const inputClass = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 4) {
      setError('New password must be at least 4 characters.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must differ from your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await changePasswordApi(currentPassword, newPassword);
      setSuccess('Password updated. Redirecting…');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify('Password updated');
      // Send the user back to their landing page — exact target depends on
      // role (the router redirects "/" to the right dashboard for each role).
      setTimeout(() => navigate('/', { replace: true }), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl border border-gray-100 p-6">
      <div className="mb-5">
        <div className="text-lg font-medium text-gray-900">Change password</div>
        <div className="text-xs text-gray-500 mt-0.5">
          Signed in as <strong>{user?.name}</strong>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-lg text-sm">{success}</div>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="cur" className="block text-xs text-gray-500 mb-1">Current password</label>
          <PasswordInput
            id="cur"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="new" className="block text-xs text-gray-500 mb-1">New password</label>
          <PasswordInput
            id="new"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
            placeholder="At least 4 characters"
          />
        </div>
        <div>
          <label htmlFor="conf" className="block text-xs text-gray-500 mb-1">Confirm new password</label>
          <PasswordInput
            id="conf"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-2.5 bg-[#1a3c5e] text-white rounded-lg hover:bg-[#15304d] disabled:opacity-50 text-sm font-medium"
          >
            {loading ? 'Updating…' : 'Update password'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
