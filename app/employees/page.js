"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/app/components/DashboardShell";
import Modal from "@/app/components/Modal";
import Link from "next/link";

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({ uid: "", name: "", department: "" });
  const [editFormData, setEditFormData] = useState({ uid: "", name: "", department: "" });
  const [deleteModal, setDeleteModal] = useState({ open: false, employee: null });
  const [leaveModal, setLeaveModal] = useState({ open: false, employee: null, type: 'Izin', date: new Date().toISOString().split('T')[0], reason: '' });
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState({ open: false, employee: null });
  const [notification, setNotification] = useState(null);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ col: null, dir: 'asc' });

  const showNotif = (message, type = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const [currentUser, setCurrentUser] = useState(null);
  const [userLoaded, setUserLoaded] = useState(false);

  const fetchEmployees = async () => {
    try {
      const res = await fetch("/api/employees");
      const json = await res.json();
      if (json.data) setEmployees(json.data);
    } catch (e) { console.error(e); }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch("/api/logs");
      const json = await res.json();
      if (json.metrics) setMetrics(json.metrics);
    } catch (e) { console.error(e); }
  };

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const json = await res.json();
      if (json.user) setCurrentUser(json.user);
    } catch (e) { console.error(e); } finally {
      setUserLoaded(true);
    }
  };

  // Hanya true jika data user sudah loaded DAN role-nya superadmin atau sdm
  const isSuperAdmin = userLoaded && (currentUser?.role === 'superadmin' || currentUser?.role === 'sdm');

  useEffect(() => {
    fetchEmployees();
    fetchMetrics();
    fetchCurrentUser();
    const iv = setInterval(fetchMetrics, 30000);
    return () => clearInterval(iv);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(await res.text());
      showNotif("Karyawan berhasil ditambahkan!", "success");
      setAddModal(false);
      setFormData({ uid: "", name: "", department: "" });
      fetchEmployees();
    } catch (err) {
      showNotif(err.message || "Gagal menyimpan data", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/employees/${editFormData.uid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editFormData),
      });
      if (!res.ok) throw new Error(await res.text());
      showNotif("Data karyawan berhasil diperbarui!", "success");
      setEditModal({ open: false, employee: null });
      fetchEmployees();
    } catch (err) {
      showNotif(err.message || "Gagal memperbarui data", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal.employee) return;
    try {
      const res = await fetch(`/api/employees/${deleteModal.employee.uid}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteModal({ open: false, employee: null });
        fetchEmployees();
        showNotif("Karyawan berhasil dihapus.");
      } else {
        showNotif("Gagal menghapus karyawan.", "error");
      }
    } catch (e) {
      showNotif("Terjadi kesalahan.", "error");
    }
  };

  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: leaveModal.employee.uid,
          date: leaveModal.date,
          type: leaveModal.type,
          reason: leaveModal.reason,
        }),
      });
      if (res.ok) {
        setLeaveModal({ open: false, employee: null, type: 'Izin', date: new Date().toISOString().split('T')[0], reason: '' });
        showNotif("Data Izin/Cuti berhasil disimpan!");
      } else {
        const json = await res.json();
        showNotif(json.error || "Gagal menyimpan data izin.", "error");
      }
    } catch (e) {
      showNotif("Terjadi kesalahan.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  let filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    String(e.uid).includes(search)
  );

  if (sortConfig.col) {
    filtered.sort((a, b) => {
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

  return (
    <DashboardShell metrics={metrics}>

      {/* Toast Notification */}
      {notification && (
        <div style={{
          position: "fixed", top: "72px", right: "24px", zIndex: 200,
          display: "flex", alignItems: "center", gap: "8px",
          padding: "12px 18px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          background: notification.type === "error" ? "var(--color-error)" : "var(--color-primary)",
          color: "var(--color-surface)", animation: "slideIn 0.2s ease",
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px", fontVariationSettings: "'FILL' 1" }}>
            {notification.type === "error" ? "error" : "check_circle"}
          </span>
          {notification.message}
        </div>
      )}

      {/* ── Page Container ─────────────────────────────────────────────── */}
      <div className="dashboard-container">

        {/* ── Page Header ──────────────────────────────────────────────── */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "flex-end", flexWrap: "wrap", gap: "16px",
          marginBottom: "28px",
        }}>
          <div>
            <h1 style={{
              margin: "0 0 4px", fontSize: "36px", fontWeight: 700,
              color: "var(--color-on-background)", letterSpacing: "-0.02em",
            }}>
              Manajemen Karyawan
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--color-outline)" }}>
              Kelola basis data karyawan dan pemetaan identitas (UID) perangkat absensi.
            </p>
          </div>

          {isSuperAdmin && (
          <button onClick={() => setAddModal(true)} style={{
            background: "var(--color-primary)", color: "#fff", border: "none",
            padding: "10px 18px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "8px",
            fontSize: "14px", fontWeight: "600", transition: "all 0.2s ease",
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,61,155,0.3)",
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>person_add</span>
            Tambah Data
          </button>
          )}
        </div>

        {/* ── Stats Row ─────────────────────────────────────────────────── */}
        <div className="stats-grid">
          {[
            { label: "Total Karyawan", value: employees.length, icon: "group", color: "var(--color-primary)", bg: "rgba(5,150,105,0.08)" },
            { label: "Telah Memindai", value: metrics.authorized || 0, icon: "fingerprint", color: "#1a7a4a", bg: "rgba(26,122,74,0.08)" },
            { label: "Tidak Dikenali", value: metrics.unauthorized || 0, icon: "person_off", color: "var(--color-error)", bg: "rgba(239,68,68,0.08)" },
          ].map((stat, i) => (
            <div key={i} style={{
              background: "var(--color-surface)", border: "1px solid #e4efff",
              borderRadius: "14px", padding: "20px 24px",
              display: "flex", alignItems: "center", gap: "16px",
            }}>
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px",
                background: stat.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: "22px", color: stat.color, fontVariationSettings: "'FILL' 1" }}>{stat.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
                <div style={{ fontSize: "24px", fontWeight: 700, color: stat.color, lineHeight: 1.3 }}>{stat.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Table Card ──────────────────────────────────────────────────── */}
        <div style={{ background: "var(--color-surface)", border: "1px solid #e4efff", borderRadius: "16px", overflow: "hidden" }}>

          {/* Table Toolbar */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "18px 24px", borderBottom: "1px solid #e4efff", flexWrap: "wrap", gap: "12px",
          }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-on-background)" }}>
              Daftar Karyawan
              <span style={{
                marginLeft: "8px", fontSize: "12px", fontWeight: 600,
                background: "var(--color-surface-container-high)", color: "var(--color-primary)",
                padding: "2px 10px", borderRadius: "20px",
              }}>{filtered.length}</span>
            </div>

            {/* Search */}
            <div style={{ position: "relative" }}>
              <span className="material-symbols-outlined" style={{
                position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)",
                fontSize: "16px", color: "var(--color-outline)",
              }}>search</span>
              <input
                type="text"
                placeholder="Cari nama atau UID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  padding: "9px 14px 9px 36px", border: "1px solid #c3c6d6",
                  borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)",
                  background: "var(--color-background)", outline: "none", width: "240px",
                }}
              />
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ background: "var(--color-background)", borderBottom: "1px solid #e4efff" }}>
                  {[
                    { key: "uid", label: "UID", width: "1%" },
                    { key: "name", label: "Nama Karyawan", width: "auto" },
                    { key: "department", label: "Departemen", width: "auto" },
                    { key: null, label: "Aksi", width: "1%", hide: !isSuperAdmin },
                  ].filter(h => !h.hide).map(h => (
                    <th key={h.label}
                        onClick={() => {
                          if (!h.key) return;
                          setSortConfig(s => ({
                            col: h.key,
                            dir: s.col === h.key && s.dir === 'asc' ? 'desc' : 'asc'
                          }));
                        }}
                        style={{
                          padding: "12px 20px", textAlign: "left", width: h.width || "auto",
                          fontSize: "12px", fontFamily: "'JetBrains Mono', monospace",
                          color: "var(--color-outline)", textTransform: "uppercase",
                          letterSpacing: "0.08em", fontWeight: 600,
                          cursor: h.key ? 'pointer' : 'default', userSelect: "none"
                        }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
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
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ padding: "48px", textAlign: "center", color: "var(--color-outline)" }}>
                      <span className="material-symbols-outlined" style={{ display: "block", fontSize: "40px", opacity: 0.3, marginBottom: "8px" }}>group</span>
                      {search ? "Tidak ada karyawan yang cocok" : "Belum ada karyawan terdaftar"}
                    </td>
                  </tr>
                ) : filtered.map((emp) => (
                  <tr
                    key={emp.id}
                    style={{ borderBottom: "1px solid #f0f4ff", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--color-background)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "14px 20px", width: "1%", whiteSpace: "nowrap" }}>
                      <span style={{
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "12px",
                        background: "var(--color-surface-container-high)", color: "var(--color-primary)",
                        padding: "3px 10px", borderRadius: "6px", fontWeight: 600,
                      }}>{emp.uid}</span>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{
                          width: "32px", height: "32px", borderRadius: "50%",
                          background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "13px", fontWeight: 700, color: "var(--color-surface)", flexShrink: 0,
                        }}>
                          {emp.name.charAt(0).toUpperCase()}
                        </div>
                        {emp.name 
                          ? (
                              <Link href={`/employees/${emp.uid}`} style={{ fontWeight: 600, color: "var(--color-on-background)", fontSize: "14px", textDecoration: "none" }}>
                                {emp.name}
                              </Link>
                            )
                          : <span style={{ color: "var(--color-error)", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>- (Sinkronisasi diperlukan)</span>
                        }
                      </div>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      {emp.department ? (
                        <span style={{
                          fontSize: "12px", padding: "3px 10px", borderRadius: "6px",
                          background: "#f0f4ff", color: "#46617b", fontWeight: 500,
                        }}>{emp.department}</span>
                      ) : (
                        <span style={{ color: "var(--color-outline-variant)", fontSize: "13px" }}>—</span>
                      )}
                    </td>
                    {isSuperAdmin && (
                    <td style={{ padding: "14px 20px", width: "1%", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          onClick={() => {
                            setEditFormData({ uid: emp.uid, name: emp.name, department: emp.department || "" });
                            setEditModal({ open: true, employee: emp });
                          }}
                          style={{
                            width: "32px", height: "32px", borderRadius: "8px",
                            border: "1px solid #cce0ff", background: "#f0f6ff",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#e4efff"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "#f0f6ff"; }}
                          title="Edit Data Karyawan"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "var(--color-primary)" }}>edit</span>
                        </button>
                        <button
                          onClick={() => setLeaveModal({ open: true, employee: emp, type: 'Izin', date: new Date().toISOString().split('T')[0], reason: '' })}
                          style={{
                            width: "32px", height: "32px", borderRadius: "8px",
                            border: "1px solid #eab308", background: "#fefce8",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#fef08a"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "#fefce8"; }}
                          title="Input Izin/Sakit/Cuti"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "#ca8a04" }}>event_note</span>
                        </button>
                        <button
                          onClick={() => setDeleteModal({ open: true, employee: emp })}
                        style={{
                          width: "32px", height: "32px", borderRadius: "8px",
                          border: "1px solid #ffdad6", background: "#fff8f7",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--color-error-container)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "#fff8f7"; }}
                        title="Hapus karyawan"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "var(--color-error)" }}>delete</span>
                      </button>
                      </div>
                    </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Add Employee Modal ───────────────────────────────────────────── */}
      <Modal isOpen={addModal} onClose={() => setAddModal(false)} title="Tambah Karyawan Baru" size="sm">
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {[
            { key: "uid", label: "Device UID", type: "number", placeholder: "contoh: 5", required: true },
            { key: "name", label: "Nama Lengkap", type: "text", placeholder: "Nama Karyawan", required: true },
            { key: "department", label: "Departemen", type: "text", placeholder: "contoh: HRD", required: false },
          ].map(field => (
            <div key={field.key}>
              <label style={{
                display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600,
                color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em",
                fontFamily: "'JetBrains Mono', monospace",
              }}>{field.label}</label>
              <input
                type={field.type}
                required={field.required}
                placeholder={field.placeholder}
                value={formData[field.key]}
                onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px", border: "1.5px solid #c3c6d6",
                  borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)",
                  background: "var(--color-background)", outline: "none",
                }}
                onFocus={e => e.target.style.borderColor = "var(--color-primary)"}
                onBlur={e => e.target.style.borderColor = "var(--color-outline-variant)"}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button type="button" onClick={() => setAddModal(false)} style={{
              padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
              background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
            }}>Batal</button>
            <button type="submit" disabled={isSubmitting} style={{
              padding: "10px 18px", background: "var(--color-primary)", border: "none",
              borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
              cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              opacity: isSubmitting ? 0.6 : 1,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>save</span>
              {isSubmitting ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Edit Employee Modal ───────────────────────────────────────────── */}
      <Modal isOpen={editModal.open} onClose={() => setEditModal({ open: false, employee: null })} title="Edit Data Karyawan" size="sm">
        <form onSubmit={handleEditSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {[
            { key: "uid", label: "Device UID", type: "number", disabled: true },
            { key: "name", label: "Nama Lengkap", type: "text", required: true },
            { key: "department", label: "Departemen", type: "text", required: false },
          ].map(field => (
            <div key={field.key}>
              <label style={{
                display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600,
                color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em",
                fontFamily: "'JetBrains Mono', monospace",
              }}>{field.label}</label>
              <input
                type={field.type}
                required={field.required}
                disabled={field.disabled}
                value={editFormData[field.key]}
                onChange={e => setEditFormData({ ...editFormData, [field.key]: e.target.value })}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px", border: "1.5px solid #c3c6d6",
                  borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)",
                  background: field.disabled ? "#f0f4ff" : "var(--color-background)", outline: "none",
                  cursor: field.disabled ? "not-allowed" : "text",
                }}
                onFocus={e => !field.disabled && (e.target.style.borderColor = "var(--color-primary)")}
                onBlur={e => !field.disabled && (e.target.style.borderColor = "var(--color-outline-variant)")}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button type="button" onClick={() => setEditModal({ open: false, employee: null })} style={{
              padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
              background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
            }}>Batal</button>
            <button type="submit" disabled={isSubmitting} style={{
              padding: "10px 18px", background: "var(--color-primary)", border: "none",
              borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
              cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              opacity: isSubmitting ? 0.6 : 1,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>save</span>
              {isSubmitting ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Input Leave Modal ────────────────────────────────────────────── */}
      <Modal isOpen={leaveModal.open} onClose={() => setLeaveModal({ ...leaveModal, open: false })} title="Input Izin/Sakit/Cuti" size="sm">
        {leaveModal.employee && (
          <form onSubmit={handleLeaveSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px", background: "var(--color-surface-container)", borderRadius: "10px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "var(--color-surface)" }}>
                {leaveModal.employee.name.charAt(0)}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-on-background)" }}>{leaveModal.employee.name}</div>
                <div style={{ fontSize: "12px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace" }}>UID: {leaveModal.employee.uid}</div>
              </div>
            </div>

            <div className="form-grid">
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Tanggal</label>
                <input type="date" required value={leaveModal.date} onChange={e => setLeaveModal({ ...leaveModal, date: e.target.value })}
                  style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Tipe</label>
                <select required value={leaveModal.type} onChange={e => setLeaveModal({ ...leaveModal, type: e.target.value })}
                  style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", boxSizing: "border-box" }}>
                  <option value="Izin">Izin</option>
                  <option value="Sakit">Sakit</option>
                  <option value="Cuti">Cuti</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Keterangan / Alasan (Opsional)</label>
              <textarea placeholder="Tuliskan keterangan..." value={leaveModal.reason} onChange={e => setLeaveModal({ ...leaveModal, reason: e.target.value })}
                rows={3}
                style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", boxSizing: "border-box", resize: "vertical" }} />
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
              <button type="button" onClick={() => setLeaveModal({ ...leaveModal, open: false })} style={{
                padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
                background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
              }}>Batal</button>
              <button type="submit" disabled={isSubmitting} style={{
                padding: "10px 18px", background: "var(--color-primary)", border: "none",
                borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                opacity: isSubmitting ? 0.6 : 1,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>save</span>
                {isSubmitting ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ────────────────────────────────────── */}
      <Modal isOpen={deleteModal.open} onClose={() => setDeleteModal({ open: false, employee: null })} title="Hapus Karyawan" size="sm">
        <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px", background: "#fff8f7", borderRadius: "12px", marginBottom: "20px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "var(--color-surface)", flexShrink: 0 }}>
            {deleteModal.employee?.name?.charAt(0)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--color-on-background)" }}>{deleteModal.employee?.name}</div>
            <div style={{ fontSize: "12px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace" }}>UID: {deleteModal.employee?.uid}</div>
          </div>
        </div>
        <p style={{ color: "var(--color-outline)", fontSize: "13px", marginBottom: "20px" }}>
          Data karyawan ini akan dihapus secara permanen dari sistem.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={() => setDeleteModal({ open: false, employee: null })} style={{
            padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
            background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
          }}>Batal</button>
          <button onClick={handleDelete} style={{
            padding: "10px 18px", background: "var(--color-error)", border: "none",
            borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
            cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>delete</span>
            Hapus
          </button>
        </div>
      </Modal>

      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        .dashboard-container { padding: 20px 40px 80px; max-width: 1440px; margin: 0 auto; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
        @media (max-width: 1024px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 767px) {
          .dashboard-container { padding: 20px 16px 80px; }
          .stats-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </DashboardShell>
  );
}
