import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// The legacy /reset-password page (email-link flow) has been retired in
// favour of the two-step OTP form on /forgot-password. Anyone landing here
// from a bookmarked or emailed URL is redirected forward.
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/forgot-password', { replace: true });
  }, [navigate]);
  return null;
}
