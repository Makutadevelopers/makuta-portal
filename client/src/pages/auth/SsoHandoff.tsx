/**
 * /sso — entry point used by the makuta-sales-crm "Open Accounting Portal"
 * button. Reads ?token= and ?user= (base64-encoded JSON) from the URL,
 * writes them to localStorage under the same keys AuthContext expects, then
 * redirects to / (which RootRedirect routes by role).
 *
 * No portal-side code generates these params; only the CRM does, by calling
 * /api/auth/login server-to-server with the configured service account.
 */

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function SsoHandoff() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get('token');
    const userParam = params.get('user');
    if (!token || !userParam) {
      navigate('/login', { replace: true });
      return;
    }

    try {
      const userJson = atob(decodeURIComponent(userParam));
      // Validate it parses — don't write garbage into localStorage.
      JSON.parse(userJson);
      localStorage.setItem('makuta_token', token);
      localStorage.setItem('makuta_user', userJson);
      // Optional ?next= path lets the CRM embed deep-link to specific portal
      // pages (Vendor Aging, Bank Recon, etc.) in iframes. Defaults to "/".
      const rawNext = params.get('next') ?? '/';
      const next = rawNext.startsWith('/') ? rawNext : '/';
      // Hard reload so AuthContext re-reads localStorage on init.
      window.location.replace(next);
    } catch {
      navigate('/login', { replace: true });
    }
  }, [params, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen text-sm text-gray-500">
      Signing you in…
    </div>
  );
}
