import { useState, useEffect, useCallback } from 'react';
import { getUsers, createUser, updateUser, resetUserPassword, UserRecord } from '../../api/users';
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

  useEffect(() => { loadUsers(); }, [loadUsers]);

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
                {filtered.map(u => (
                  <tr key={u.id} className={`hover:bg-gray-50/50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{u.name}</div>
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
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => openEdit(u)} className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => { setShowResetModal(u); setNewPassword(''); }} className="text-xs text-amber-600 hover:underline">Reset Pwd</button>
                        <button onClick={() => handleToggleActive(u)} className={`text-xs ${u.is_active ? 'text-red-500' : 'text-green-600'} hover:underline`}>
                          {u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
    </AppShell>
  );
}
