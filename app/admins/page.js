"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/app/components/DashboardShell";
import Modal from "@/app/components/Modal";

export default function Admins() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, mode: 'add', data: null });
  const [formData, setFormData] = useState({ username: '', password: '', role: 'admin', department: '' });
  const [alertMsg, setAlertMsg] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', data: null, title: '', message: '' });
  const [sortConfig, setSortConfig] = useState({ col: null, dir: 'asc' });

  useEffect(() => {
    fetchAdmins();
  }, []);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admins");
      if (res.ok) {
        const data = await res.json();
        setAdmins(data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const url = modal.mode === 'add' ? '/api/admins' : `/api/admins/${modal.data.id}`;
      const method = modal.mode === 'add' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      const json = await res.json();
      
      if (res.ok) {
        setAlertMsg({ type: 'success', text: json.message });
        setModal({ open: false, mode: 'add', data: null });
        fetchAdmins();
      } else {
        setAlertMsg({ type: 'error', text: json.error });
      }
    } catch (error) {
      setAlertMsg({ type: 'error', text: "Gagal menghubungi server" });
    }
  };

  const handleResetPassword = async (id) => {
    try {
      const res = await fetch(`/api/admins/${id}/reset`, { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        setAlertMsg({ type: 'success', text: json.message });
      } else {
        setAlertMsg({ type: 'error', text: json.error });
      }
    } catch (error) {
      setAlertMsg({ type: 'error', text: "Gagal menghubungi server" });
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/admins/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (res.ok) {
        setAlertMsg({ type: 'success', text: json.message });
        fetchAdmins();
      } else {
        setAlertMsg({ type: 'error', text: json.error });
      }
    } catch (error) {
      setAlertMsg({ type: 'error', text: "Gagal menghubungi server" });
    }
  };

  const openModal = (mode, data = null) => {
    setModal({ open: true, mode, data });
    if (mode === 'edit' && data) {
      setFormData({ username: data.username, password: '', role: data.role, department: data.department || '' });
    } else {
      setFormData({ username: '', password: '', role: 'admin', department: '' });
    }
    setAlertMsg(null);
  };

  return (
    <DashboardShell>
      <div className="dashboard-container" style={{ padding: "20px 40px", maxWidth: "1000px", margin: "0 auto" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
          <div style={{ flex: "1 1 300px" }}>
            <h1 style={{ margin: 0, fontSize: "32px", fontWeight: 700, color: "var(--color-on-background)", letterSpacing: "-0.02em" }}>Manajemen Admin</h1>
            <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--color-outline)" }}>
              Kelola pengguna yang dapat login ke dasbor. 
              <strong> Superadmin</strong> memiliki akses penuh untuk menambah, mengedit, dan menghapus seluruh admin, 
              sedangkan <strong>Admin</strong> biasa hanya dapat melihat data.
            </p>
          </div>
          <button onClick={() => openModal('add')} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 18px", background: "var(--color-primary)", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, color: "var(--color-on-primary)", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>person_add</span>
            Tambah Admin
          </button>
        </div>

        {alertMsg && (
          <div style={{ padding: "12px 16px", borderRadius: "8px", marginBottom: "20px", background: alertMsg.type === 'success' ? "var(--color-surface-container)" : "var(--color-error-container)", color: alertMsg.type === 'success' ? "var(--color-primary)" : "var(--color-on-error-container)", display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", fontWeight: 500 }}>
            <span className="material-symbols-outlined">{alertMsg.type === 'success' ? 'check_circle' : 'error'}</span>
            {alertMsg.text}
          </div>
        )}

        <div className="glass-card" style={{ borderRadius: "16px", padding: "24px", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--color-outline)" }}>Memuat data...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
                <thead>
                <tr style={{ borderBottom: "2px solid var(--color-surface-container-high)" }}>
                  {[
                    { key: "id", label: "ID", align: "left" },
                    { key: "username", label: "Username", align: "left" },
                    { key: "role", label: "Role", align: "left" },
                    { key: "created_at", label: "Dibuat Pada", align: "left" },
                    { key: null, label: "Aksi", align: "right" },
                  ].map(h => (
                    <th key={h.label} 
                        onClick={() => {
                          if (!h.key) return;
                          setSortConfig(s => ({
                            col: h.key,
                            dir: s.col === h.key && s.dir === 'asc' ? 'desc' : 'asc'
                          }));
                        }}
                        style={{ 
                          padding: "12px 16px", textAlign: h.align, fontSize: "12px", 
                          color: "var(--color-outline)", textTransform: "uppercase", 
                          fontWeight: 600, cursor: h.key ? "pointer" : "default", userSelect: "none" 
                        }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: h.align === 'right' ? 'flex-end' : 'flex-start' }}>
                        {h.label}
                        {sortConfig.col === h.key && h.key && (
                          <span className="material-symbols-outlined" style={{ fontSize: "14px", color: "var(--color-primary)" }}>
                            {sortConfig.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let sortedAdmins = [...admins];
                  if (sortConfig.col) {
                    sortedAdmins.sort((a, b) => {
                      let aVal = a[sortConfig.col];
                      let bVal = b[sortConfig.col];
                      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                      if (aVal === undefined || aVal === null) aVal = "";
                      if (bVal === undefined || bVal === null) bVal = "";
                      
                      if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1;
                      if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1;
                      return 0;
                    });
                  }
                  
                  if (sortedAdmins.length === 0) {
                    return <tr><td colSpan="5" style={{ padding: "30px", textAlign: "center", color: "var(--color-outline)" }}>Belum ada data admin</td></tr>;
                  }

                  return sortedAdmins.map(admin => (
                  <tr key={admin.id} style={{ borderBottom: "1px solid var(--color-surface-variant)" }}>
                    <td style={{ padding: "16px", fontSize: "14px", color: "var(--color-on-background)" }}>#{admin.id}</td>
                    <td style={{ padding: "16px", fontSize: "14px", fontWeight: 600, color: "var(--color-on-background)" }}>{admin.username}</td>
                    <td style={{ padding: "16px" }}>
                      <span style={{
                        padding: "4px 10px",
                        background: admin.role === 'superadmin' ? 'rgba(5,150,105,0.12)'
                          : admin.role === 'sdm' ? 'rgba(99,102,241,0.12)'
                          : 'rgba(71,85,105,0.1)',
                        color: admin.role === 'superadmin' ? '#059669'
                          : admin.role === 'sdm' ? '#6366f1'
                          : 'var(--color-secondary)',
                        borderRadius: "20px", fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em"
                      }}>
                        {admin.role === 'superadmin' ? 'Super Admin' : admin.role === 'sdm' ? 'SDM' : 'Admin'}
                      </span>
                    </td>
                    <td style={{ padding: "16px", fontSize: "14px", color: "var(--color-on-surface-variant)" }}>{new Date(admin.created_at).toLocaleDateString('id-ID')}</td>
                    <td style={{ padding: "16px", textAlign: "right" }}>
                      <button onClick={() => setConfirmModal({ open: true, type: 'reset', data: admin.id, title: 'Reset Password', message: "Apakah Anda yakin ingin mereset password admin ini menjadi 'admin123'?" })} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-secondary)", padding: "4px", marginRight: "8px" }} title="Reset Password ke default">
                        <span className="material-symbols-outlined">lock_reset</span>
                      </button>
                      <button onClick={() => openModal('edit', admin)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: "4px", marginRight: "8px" }} title="Edit Admin">
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button onClick={() => setConfirmModal({ open: true, type: 'delete', data: admin.id, title: 'Hapus Admin', message: "Apakah Anda yakin ingin menghapus admin ini secara permanen?" })} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-error)", padding: "4px" }} title="Hapus Admin">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </td>
                  </tr>
                  ));
                })()}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={modal.open} onClose={() => setModal({ ...modal, open: false })} title={modal.mode === 'add' ? "Tambah Admin" : "Edit Admin"} size="sm">
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "var(--color-outline)" }}>Username</label>
            <input type="text" required value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid var(--color-outline-variant)", borderRadius: "8px", fontSize: "14px", outline: "none", background: "var(--color-surface)" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "var(--color-outline)" }}>
              Password {modal.mode === 'edit' && <span style={{ fontWeight: 400 }}>(Kosongkan jika tidak ingin diubah)</span>}
            </label>
            <input type="password" required={modal.mode === 'add'} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid var(--color-outline-variant)", borderRadius: "8px", fontSize: "14px", outline: "none", background: "var(--color-surface)" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "var(--color-outline)" }}>Role</label>
            <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid var(--color-outline-variant)", borderRadius: "8px", fontSize: "14px", outline: "none", background: "var(--color-surface)" }}>
              <option value="admin">Admin (Monitoring saja)</option>
              <option value="sdm">SDM (Monitoring Full - Tanpa Kelola Admin)</option>
              <option value="superadmin">Super Admin (Akses Penuh)</option>
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button type="button" onClick={() => setModal({ ...modal, open: false })} style={{ padding: "10px 18px", border: "1px solid var(--color-outline-variant)", borderRadius: "8px", background: "var(--color-surface-container-lowest)", fontSize: "14px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)" }}>Batal</button>
            <button type="submit" style={{ padding: "10px 18px", background: "var(--color-primary)", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, color: "var(--color-on-primary)", cursor: "pointer" }}>Simpan</button>
          </div>
        </form>
      </Modal>

      {/* Confirmation Modal */}
      <Modal isOpen={confirmModal.open} onClose={() => setConfirmModal({ ...confirmModal, open: false })} title={confirmModal.title} size="sm">
        <p style={{ color: "var(--color-outline)", fontSize: "14px", marginBottom: "20px", lineHeight: 1.5 }}>
          {confirmModal.message}
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={() => setConfirmModal({ ...confirmModal, open: false })} style={{ padding: "10px 18px", border: "1px solid var(--color-outline-variant)", borderRadius: "8px", background: "var(--color-surface-container-lowest)", fontSize: "14px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)" }}>
            Batal
          </button>
          <button onClick={() => {
            if (confirmModal.type === 'delete') handleDelete(confirmModal.data);
            if (confirmModal.type === 'reset') handleResetPassword(confirmModal.data);
            setConfirmModal({ ...confirmModal, open: false });
          }} style={{ padding: "10px 18px", background: confirmModal.type === 'delete' ? "var(--color-error)" : "var(--color-secondary)", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, color: "var(--color-on-primary)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              {confirmModal.type === 'delete' ? 'delete' : 'lock_reset'}
            </span>
            {confirmModal.type === 'delete' ? 'Hapus' : 'Reset'}
          </button>
        </div>
      </Modal>
    </DashboardShell>
  );
}
