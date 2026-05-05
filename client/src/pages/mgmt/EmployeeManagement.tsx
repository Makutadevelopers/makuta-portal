import { useState, useEffect, useCallback } from 'react';
import { getUsers, createUser, updateUser, resetUserPassword, sendTempPassword, UserRecord } from '../../api/users';
import { getAlerts, resolveAlert, Alert } from '../../api/alerts';
import { useToast } from '../../context/ToastContext';
import AppShell from '../../components/layout/AppShell';

const SITES = ['Nirvana', 'Taranga', 'Horizon', 'Green Wood Villas', 'Aruna Arcade', 'Office'];
const ROLES: { value: string; label: string }[] = [
  { value: 'ho', label: 'Head Office' },
  { value: 'mgmt', label: 'Management' },
  { value: 'site', label: 'Site Accountant' },
];

export default function EmployeeManagement() {
  const { notify } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [showResetModal, setShowResetModal] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [filter, setFilter] = useState('all');
  const [pendingResets, setPendingResets] = useState<Alert[]>([]);
  const [tempPasswordResult, setTempPasswordResult] = useState<{
    tempPassword: string;
    userName: string;
    userEmail: string;
  } | null>(null);
  const [sendingTempFor, setSendingTempFor] = useState<string | null>(null);
  const [confirmTempFor, setConfirmTempFor] = useState<UserRecord | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'site', site: '' as string | null, title: 'Site Accountant',
  });

  const loadUsers = useCallback(async () => {
    try {
      const data = await getUsers();
      setUsers(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadPendingResets = useCallback(async () => {
    try {
      const all = await getAlerts();
      setPendingResets(all.filter(a => a.alert_type === 'password_reset_request'));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadUsers(); loadPendingResets(); }, [loadUsers, loadPendingResets]);

  function userIdFromAlert(alert: Alert): string | null {
    const meta = alert.metadata as Record<string, string> | null;
    return meta?.userId ?? null;
  }

  const pendingByUserId = new Map<string, Alert>(
    pendingResets
      .map(a => [userIdFromAlert(a), a] as [string | null, Alert])
      .filter((entry): entry is [string, Alert] => entry[0] !== null)
  );

  async function handleSendTempPassword(u: UserRecord) {
    setConfirmTempFor(null);
    setSendingTempFor(u.id);
    try {
      const result = await sendTempPassword(u.id);
      setTempPasswordResult({
        tempPassword: result.tempPassword,
        userName: result.userName,
        userEmail: result.userEmail,
      });
      // Refresh alerts so the badge clears.
      loadPendingResets();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to generate temp password', 'error');
    } finally {
      setSendingTempFor(null);
    }
  }

  async function handleDismissRequest(alert: Alert) {
    try {
      await resolveAlert(alert.id);
      loadPendingResets();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to dismiss', 'error');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => notify('Copied to clipboard', 'success'),
      () => notify('Could not copy — select and copy manually', 'error'),
    );
  }

  function openCreate() {
    setEditUser(null);
    setForm({ name: '', email: '', password: '', role: 'site', site: '', title: 'Site Accountant' });
    setShowForm(true);
  }

  function openEdit(u: UserRecord) {
    setEditUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      site: u.site || '',
      title: u.title || '',
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editUser) {
        await updateUser(editUser.id, {
          name: form.name,
          email: form.email,
          role: form.role,
          site: form.role === 'site' ? form.site : null,
          title: form.title || null,
        });
        notify(`Updated ${form.name}`, 'success');
      } else {
        await createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          site: form.role === 'site' ? form.site : null,
          title: form.title || null,
        });
        notify(`Created ${form.name}`, 'success');
      }
      setShowForm(false);
      loadUsers();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save', 'error');
    }
  }

  async function handleToggleActive(u: UserRecord) {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      notify(`${u.name} ${u.is_active ? 'deactivated' : 'activated'}`, 'success');
      loadUsers();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update', 'error');
    }
  }

  async function handleResetPassword() {
    if (!showResetModal || !newPassword) return;
    try {
      await resetUserPassword(showResetModal.id, newPassword);
      notify(`Password reset for ${showResetModal.name}`, 'success');
      setShowResetModal(null);
      setNewPassword('');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to reset', 'error');
    }
  }

  const filtered = filter === 'all' ? users : users.filter(u => u.role === filter);

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      ho: 'bg-blue-100 text-blue-800',
      mgmt: 'bg-purple-100 text-purple-800',
      site: 'bg-green-100 text-green-800',
    };
    const labels: Record<string, string> = { ho: 'HO', mgmt: 'MD', site: 'Site' };
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${colors[role] || 'bg-gray-100'}`}>{labels[role] || role}</span>;
  };

  return (
    <AppShell>
      <div className="max-w-[1000px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-lg font-medium text-gray-900">Employee Management</div>
            <div className="text-xs text-gray-500 mt-1">Add, edit, and manage user accounts</div>
          </div>
          <button onClick={openCreate} className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15324e]">
            + Add Employee
          </button>
        </div>

        {pendingResets.length > 0 && (
          <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-amber-900">
                  {pendingResets.length} password reset request{pendingResets.length === 1 ? '' : 's'} pending
                </div>
                <div className="text-xs text-amber-800 mt-1">
                  Click <strong>"Send Temp Password"</strong> on the user's row below to generate and share a one-time password.
                </div>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-amber-200/60">
              {pendingResets.map(alert => {
                const meta = alert.metadata as Record<string, string> | null;
                return (
                  <li key={alert.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="text-sm text-amber-900">
                      <span className="font-medium">{meta?.name ?? 'Someone'}</span>
                      <span className="text-amber-700 text-xs ml-2">{meta?.email}</span>
                      <span className="text-amber-600 text-[10px] ml-3">
                        {new Date(alert.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDismissRequest(alert)}
                      className="text-[11px] text-amber-700 hover:underline"
                      title="Dismiss without sending a temp password"
                    >
                      Dismiss
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-5">
          {[{ v: 'all', l: `All (${users.length})` }, { v: 'ho', l: `HO (${users.filter(u => u.role === 'ho').length})` }, { v: 'mgmt', l: `MD (${users.filter(u => u.role === 'mgmt').length})` }, { v: 'site', l: `Site (${users.filter(u => u.role === 'site').length})` }].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium ${filter === f.v ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f.l}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-gray-400 text-sm py-12 text-center">Loading...</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/60 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Site</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(u => {
                  const hasPending = pendingByUserId.has(u.id);
                  return (
                    <tr key={u.id} className={`hover:bg-gray-50/50 ${!u.is_active ? 'opacity-50' : ''} ${hasPending ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 flex items-center gap-2">
                          {u.name}
                          {hasPending && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded-full font-medium">
                              reset requested
                            </span>
                          )}
                        </div>
                        {u.title && <div className="text-[11px] text-gray-400">{u.title}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{u.email}</td>
                      <td className="px-4 py-3">{roleBadge(u.role)}</td>
                      <td className="px-4 py-3 text-gray-600">{u.site || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <button onClick={() => openEdit(u)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button
                            onClick={() => setConfirmTempFor(u)}
                            disabled={sendingTempFor === u.id || !u.is_active}
                            className={`text-xs hover:underline disabled:opacity-50 disabled:no-underline ${hasPending ? 'text-amber-700 font-medium' : 'text-amber-600'}`}
                            title="Generate a one-time password and show it for sharing"
                          >
                            {sendingTempFor === u.id ? 'Generating…' : 'Send Temp Password'}
                          </button>
                          <button onClick={() => { setShowResetModal(u); setNewPassword(''); }} className="text-xs text-gray-500 hover:underline" title="Set a specific password manually">Set Pwd</button>
                          <button onClick={() => handleToggleActive(u)} className={`text-xs ${u.is_active ? 'text-red-500' : 'text-green-600'} hover:underline`}>
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">No employees found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowForm(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <div className="text-lg font-medium text-gray-900 mb-5">{editUser ? 'Edit Employee' : 'Add Employee'}</div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
                {!editUser && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
                    <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
                    <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  {form.role === 'site' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Site *</label>
                      <select value={form.site || ''} onChange={e => setForm(f => ({ ...f, site: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                        <option value="">Select site</option>
                        {SITES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                  <input value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Site Accountant"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15324e]">
                  {editUser ? 'Save Changes' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowResetModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
              <div className="text-lg font-medium text-gray-900 mb-2">Reset Password</div>
              <div className="text-sm text-gray-500 mb-5">Set a new password for <strong>{showResetModal.name}</strong></div>

              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new password" autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mb-4" />

              <div className="flex justify-end gap-3">
                <button onClick={() => setShowResetModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button onClick={handleResetPassword} disabled={!newPassword}
                  className="px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 disabled:opacity-50">
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Confirm before generating a temp password */}
      {confirmTempFor && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setConfirmTempFor(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
              <div className="text-base font-medium text-gray-900 mb-2">Generate temp password?</div>
              <div className="text-sm text-gray-600 mb-1">
                A one-time password will be generated for <strong>{confirmTempFor.name}</strong>.
              </div>
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md p-2.5 mt-3 mb-5">
                Their current password will be replaced. You'll see the new password on the next screen — copy and share it via WhatsApp / phone.
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmTempFor(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSendTempPassword(confirmTempFor)}
                  className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d]"
                >
                  Generate password
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Temp Password reveal modal — shown right after generation. */}
      {tempPasswordResult && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setTempPasswordResult(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
              <div className="text-lg font-medium text-gray-900 mb-1">Temporary password generated</div>
              <div className="text-sm text-gray-500 mb-5">
                Share this with <strong>{tempPasswordResult.userName}</strong> via WhatsApp or phone.
                They use it to sign in once, then change their password.
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 flex items-center justify-between gap-3">
                <code className="text-lg font-mono tracking-widest text-gray-900 select-all">
                  {tempPasswordResult.tempPassword}
                </code>
                <button
                  onClick={() => copyToClipboard(tempPasswordResult.tempPassword)}
                  className="px-3 py-1.5 bg-[#1a3c5e] text-white text-xs rounded hover:bg-[#15304d]"
                >
                  Copy
                </button>
              </div>

              <div className="text-xs text-gray-500 space-y-1 mb-5">
                <div>👤 {tempPasswordResult.userName}</div>
                <div>✉️ {tempPasswordResult.userEmail} <span className="text-gray-400">(also emailed if SMTP is set)</span></div>
                <div className="text-amber-700 mt-2">
                  ⚠ The user's old password is now invalid. They must use this one-time password for their next sign-in.
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setTempPasswordResult(null)}
                  className="px-4 py-2 bg-[#1a3c5e] text-white text-sm rounded-lg hover:bg-[#15304d]"
                >
                  Done — I've shared it
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
