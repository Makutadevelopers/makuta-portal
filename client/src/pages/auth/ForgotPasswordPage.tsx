import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { forgotPasswordApi, resetPasswordApi } from '../../api/auth';
import PasswordInput from '../../components/shared/PasswordInput';

// Two-step self-service reset:
//   1. user enters email -> server emails a 6-digit OTP
//   2. user types the OTP + a new password -> server verifies + saves
type Step = 'request' | 'verify' | 'done';

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const inputClass =
    'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200';

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPasswordApi(email);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('The code is 6 digits.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await resetPasswordApi(email, otp.trim(), newPassword);
      setStep('done');
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setLoading(true);
    try {
      await forgotPasswordApi(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-10">
        <div className="text-center mb-7">
          <img src="/makuta-logo.jpeg" alt="Makuta Developers" className="w-20 h-20 mx-auto mb-3 object-contain" />
          <div className="text-sm font-medium text-gray-900">
            {step === 'done' ? 'Password updated' : step === 'verify' ? 'Enter the code' : 'Reset password'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {step === 'request' && 'Enter the email tied to your Makuta account'}
            {step === 'verify' && `We sent a 6-digit code to ${email}. It expires in 15 minutes.`}
            {step === 'done' && 'You can now sign in with the new password.'}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {step === 'request' && (
          <form onSubmit={handleRequest} className="space-y-3">
            <div>
              <label htmlFor="email" className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@makuta.in"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#1a3c5e] text-white rounded-lg hover:bg-[#15304d] disabled:opacity-50 text-sm font-medium mt-1"
            >
              {loading ? 'Sending…' : 'Send code'}
            </button>
            <div className="text-center pt-2">
              <Link to="/login" className="text-xs text-gray-500 hover:underline">← Back to sign in</Link>
            </div>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={handleVerify} className="space-y-3">
            <div>
              <label htmlFor="otp" className="block text-xs text-gray-500 mb-1">6-digit code</label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center text-lg tracking-[0.5em] font-mono`}
                placeholder="••••••"
                autoFocus
                autoComplete="one-time-code"
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
                placeholder="At least 8 characters"
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
              {loading ? 'Verifying…' : 'Reset password'}
            </button>
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="text-xs text-[#1a3c5e] hover:underline disabled:opacity-50"
              >
                Resend code
              </button>
              <button
                type="button"
                onClick={() => { setStep('request'); setOtp(''); setNewPassword(''); setConfirmPassword(''); setError(''); }}
                className="text-xs text-gray-500 hover:underline"
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="text-center">
            <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-lg text-sm">
              Password updated. Redirecting to sign in…
            </div>
            <Link to="/login" className="text-sm text-[#1a3c5e] hover:underline">Go to sign in →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
