"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/app/components/DashboardShell";
import DeviceSelect, { deviceLabel, useSelectedDevice } from "@/app/components/DeviceSelect";
import Modal from "@/app/components/Modal";
import Link from "next/link";
import { sameName } from "@/lib/names";
import { useRealtimeStream } from "@/app/components/useRealtimeStream";

const todayLocal = () => new Date().toLocaleDateString("en-CA");
const emptyLeave = { open: false, employee: null, deviceId: "", type: 'Izin', date: todayLocal(), reason: '' };

const chipStyle = {
  fontSize: "12px", padding: "3px 10px", borderRadius: "6px",
  background: "var(--color-surface-container-high)", color: "var(--color-primary)", fontWeight: 500,
};

const warningChipStyle = { ...chipStyle, background: "rgba(234,179,8,0.14)", color: "#a16207", display: "inline-flex", alignItems: "center", gap: "4px" };

const smallButtonStyle = {
  display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", border: "1px solid var(--color-primary)",
  borderRadius: "8px", background: "transparent", color: "var(--color-primary)", fontSize: "13px", fontWeight: 600, cursor: "pointer",
};

const fieldStyle = {
  width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px",
  color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", boxSizing: "border-box",
};

const enrollmentKey = (item) => `${item.device_id}:${item.device_uid}`;

// Setiap chip adalah satu user mesin yang dipetakan ke Pejuang ini. Chip kuning:
// nama di mesin berbeda dengan nama Pejuang, periksa apakah pemetaannya benar.
function DeviceChips({ devices, personName, onUnlink }) {
  if (!devices?.length) return <span style={{ color: "var(--color-outline-variant)", fontSize: "13px" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {devices.map((device) => {
        const mismatch = device.machine_name && !sameName(personName, device.machine_name);
        return (
          <span key={`${device.id}:${device.device_uid}`} style={mismatch ? warningChipStyle : { ...chipStyle, display: "inline-flex", alignItems: "center", gap: "4px" }}
            title={mismatch
              ? `Di mesin ${device.name}, UID ${device.device_uid} bernama "${device.machine_name}". Lepas bila ini orang lain.`
              : `UID ${device.device_uid} di mesin ${device.name}${device.machine_name ? ` (${device.machine_name})` : ""}`}>
            {mismatch && <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>warning</span>}
            {device.name} #{device.device_uid}{mismatch ? `: ${device.machine_name}` : ""}
            {onUnlink && (
              <button type="button" onClick={() => onUnlink(device)} aria-label={`Lepas dari mesin ${device.name}`}
                style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0, marginLeft: "2px", display: "flex" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>close</span>
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

async function readError(res, fallback) {
  const json = await res.json().catch(() => ({}));
  return json.error || fallback;
}

export default function Employees() {
  const { devices, deviceId, setDeviceId, device, isAll, loaded: devicesLoaded } = useSelectedDevice({ allowAll: true });
  const [employees, setEmployees] = useState([]);
  const [unregistered, setUnregistered] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [metrics, setMetrics] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({ uid: "", name: "", department: "", link: null });
  const [editFormData, setEditFormData] = useState({ uid: "", name: "", department: "" });
  const [deleteModal, setDeleteModal] = useState({ open: false, employee: null });
  const [leaveModal, setLeaveModal] = useState(emptyLeave);
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState({ open: false, employee: null });
  const [bulkModal, setBulkModal] = useState({ open: false, selected: [], department: "" });
  const [linkModal, setLinkModal] = useState({ open: false, item: null, employeeUid: "", filter: "" });
  const [unlinkModal, setUnlinkModal] = useState({ open: false, employee: null, device: null });
  const [allEmployees, setAllEmployees] = useState([]);
  const [notification, setNotification] = useState(null);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ col: null, dir: 'asc' });

  const showNotif = (message, type = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const [currentUser, setCurrentUser] = useState(null);
  const [userLoaded, setUserLoaded] = useState(false);

  const fetchEmployees = useCallback(async () => {
    if (!devicesLoaded) return;
    try {
      const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
      const res = await fetch(`/api/employees${query}`);
      const json = await res.json();
      if (json.data) setEmployees(json.data);
      setUnregistered(json.unregistered || []);
    } catch (e) { console.error(e); } finally {
      setIsLoadingList(false);
    }
  }, [deviceId, devicesLoaded]);

  // Metrik scan hari ini hanya bermakna untuk satu mesin.
  const fetchMetrics = useCallback(async () => {
    if (!deviceId || isAll) {
      setMetrics({});
      return;
    }
    try {
      const res = await fetch(`/api/logs?device_id=${encodeURIComponent(deviceId)}`);
      const json = await res.json();
      if (json.metrics) setMetrics(json.metrics);
    } catch (e) { console.error(e); }
  }, [deviceId, isAll]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    // Data dimuat ulang setiap kali mesin yang dipilih berubah.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEmployees();
    fetchMetrics();
  }, [fetchEmployees, fetchMetrics]);

  useRealtimeStream((event) => {
    if (["employees", "attendance", "sync", "leaves", "devices"].includes(event.type)) {
      fetchEmployees();
      fetchMetrics();
    }
  });

  const refreshAll = () => {
    fetchEmployees();
    fetchMetrics();
  };

  // Tanpa `item`: tambah Pejuang manual. Dengan `item` (user mesin): Pejuang baru
  // langsung dihubungkan ke user mesin itu dan nomornya dipilih otomatis.
  const openAddModal = (item = null) => {
    setFormData(item
      ? { uid: "", name: item.name || "", department: "", link: { device_id: item.device_id, device_uid: item.device_uid, device_name: item.device_name } }
      : { uid: "", name: "", department: "", link: null });
    setAddModal(true);
  };

  const openLinkModal = async (item) => {
    setLinkModal({ open: true, item, employeeUid: item.suggestion ? String(item.suggestion.uid) : "", filter: "" });
    try {
      const res = await fetch("/api/employees");
      const json = await res.json();
      setAllEmployees(json.data || []);
    } catch (e) { console.error(e); }
  };

  const saveLink = async (deviceIdValue, deviceUid, employeeUid) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/enrollments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceIdValue, device_uid: deviceUid, employee_uid: employeeUid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan pemetaan");
      showNotif(json.message || "Pemetaan disimpan.");
      return true;
    } catch (err) {
      showNotif(err.message || "Gagal menyimpan pemetaan", "error");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkSubmit = async (e) => {
    e.preventDefault();
    if (!linkModal.employeeUid) return;
    if (await saveLink(linkModal.item.device_id, linkModal.item.device_uid, Number(linkModal.employeeUid))) {
      setLinkModal({ open: false, item: null, employeeUid: "", filter: "" });
      refreshAll();
    }
  };

  const handleUnlink = async () => {
    const { device: target } = unlinkModal;
    if (await saveLink(target.id, target.device_uid, null)) {
      setUnlinkModal({ open: false, employee: null, device: null });
      refreshAll();
    }
  };

  // Hanya user mesin yang punya nama yang bisa didaftarkan sekaligus.
  const registerable = unregistered.filter((item) => item.name);

  const openBulkModal = () => {
    // Yang mirip Pejuang yang sudah ada tidak dicentang: lebih tepat dihubungkan.
    setBulkModal({ open: true, selected: registerable.filter((item) => !item.suggestion).map(enrollmentKey), department: "" });
  };

  const toggleBulkKey = (key) => {
    setBulkModal((state) => ({
      ...state,
      selected: state.selected.includes(key) ? state.selected.filter((value) => value !== key) : [...state.selected, key],
    }));
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    const items = registerable
      .filter((item) => bulkModal.selected.includes(enrollmentKey(item)))
      .map(({ device_id, device_uid, name }) => ({ device_id, device_uid, name }));
    if (items.length === 0) {
      showNotif("Pilih minimal satu user mesin.", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/employees/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, department: bulkModal.department }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Gagal mendaftarkan Pejuang");
      showNotif(json.message || "Pejuang berhasil didaftarkan!");
      setBulkModal({ open: false, selected: [], department: "" });
      refreshAll();
    } catch (err) {
      showNotif(err.message || "Gagal mendaftarkan Pejuang", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openLeaveModal = (emp) => {
    // Bawaan: mesin yang sedang dipilih, lalu mesin tempat Pejuang terdaftar.
    const defaultDevice = !isAll && deviceId ? deviceId : String(emp.devices?.[0]?.id || devices[0]?.id || "");
    setLeaveModal({ ...emptyLeave, open: true, employee: emp, deviceId: defaultDevice });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          device_id: !isAll && deviceId ? Number(deviceId) : null,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "Gagal menyimpan data"));
      showNotif("Pejuang berhasil ditambahkan!", "success");
      setAddModal(false);
      setFormData({ uid: "", name: "", department: "", link: null });
      refreshAll();
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
      if (!res.ok) throw new Error(await readError(res, "Gagal memperbarui data"));
      showNotif("Data Pejuang berhasil diperbarui!", "success");
      setEditModal({ open: false, employee: null });
      refreshAll();
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
        refreshAll();
        showNotif("Pejuang berhasil dihapus.");
      } else {
        showNotif("Gagal menghapus Pejuang.", "error");
      }
    } catch (e) {
      showNotif("Terjadi kesalahan.", "error");
    }
  };

  const handleLeaveSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (!leaveModal.deviceId) {
        showNotif("Pilih mesin presensi terlebih dahulu.", "error");
        return;
      }
      const res = await fetch(`/api/leaves?device_id=${encodeURIComponent(leaveModal.deviceId)}`, {
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
        setLeaveModal(emptyLeave);
        refreshAll();
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
              Manajemen Pejuang
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--color-outline)" }}>
              Kelola basis data Pejuang dan pemetaan identitas (UID) perangkat absensi.
            </p>
            <div style={{ marginTop: "12px" }}>
              <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} allowAll />
            </div>
          </div>

          {isSuperAdmin && (
          <button onClick={() => openAddModal()} style={{
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
            { label: "Total Pejuang", value: employees.length, icon: "group", color: "var(--color-primary)", bg: "rgba(5,150,105,0.08)", note: isAll ? "Semua mesin" : device?.name },
            { label: "Telah Memindai", value: isAll ? "—" : metrics.authorized || 0, icon: "fingerprint", color: "#1a7a4a", bg: "rgba(26,122,74,0.08)", note: isAll ? "Pilih satu mesin" : `Hari ini · ${device?.name || "-"}` },
            { label: "Tidak Dikenali", value: isAll ? "—" : metrics.unauthorized || 0, icon: "person_off", color: "var(--color-error)", bg: "rgba(239,68,68,0.08)", note: isAll ? "Pilih satu mesin" : `Hari ini · ${device?.name || "-"}` },
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
                {stat.note && <div style={{ fontSize: "12px", color: "var(--color-outline)" }}>{stat.note}</div>}
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
              Daftar Pejuang
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
                    { key: "name", label: "Nama Pejuang", width: "auto" },
                    { key: "department", label: "Departemen", width: "auto" },
                    { key: null, label: "Mesin", width: "auto" },
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
                    <td colSpan={isSuperAdmin ? 5 : 4} style={{ padding: "48px", textAlign: "center", color: "var(--color-outline)" }}>
                      <span className="material-symbols-outlined" style={{ display: "block", fontSize: "40px", opacity: 0.3, marginBottom: "8px" }}>group</span>
                      {isLoadingList ? "Memuat data Pejuang..."
                        : search ? "Tidak ada Pejuang yang cocok"
                        : !isAll && device ? `Belum ada Pejuang yang tercatat di mesin ${device.name}`
                        : "Belum ada Pejuang terdaftar"}
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
                    <td style={{ padding: "14px 20px" }}>
                      <DeviceChips devices={emp.devices} personName={emp.name}
                        onUnlink={isSuperAdmin ? (target) => setUnlinkModal({ open: true, employee: emp, device: target }) : null} />
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
                          title="Edit Data Pejuang"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "var(--color-primary)" }}>edit</span>
                        </button>
                        <button
                          onClick={() => openLeaveModal(emp)}
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
                        title="Hapus Pejuang"
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

        {/* ── User mesin yang belum terdaftar sebagai Pejuang ────────────── */}
        {unregistered.length > 0 && (
          <div style={{ background: "var(--color-surface)", border: "1px solid #e4efff", borderRadius: "16px", overflow: "hidden", marginTop: "24px" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid #e4efff", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-on-background)" }}>
                  User Mesin Belum Terdaftar
                  <span style={{ marginLeft: "8px", fontSize: "12px", fontWeight: 600, background: "rgba(239,68,68,0.08)", color: "var(--color-error)", padding: "2px 10px", borderRadius: "20px" }}>{unregistered.length}</span>
                </div>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-outline)" }}>
                  User ini ada di mesin{!isAll && device ? ` ${device.name}` : ""}, tetapi belum dihubungkan ke Pejuang sehingga scan-nya terhitung &quot;Tidak Dikenali&quot;.
                  Hubungkan ke Pejuang yang sudah ada, atau tambahkan sebagai Pejuang baru.
                </p>
              </div>
              {isSuperAdmin && registerable.length > 0 && (
                <button onClick={openBulkModal}
                  style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", background: "var(--color-primary)", border: "none", borderRadius: "8px", color: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>group_add</span>
                  Daftarkan semua ({registerable.length})
                </button>
              )}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
                <thead>
                  <tr style={{ background: "var(--color-background)", borderBottom: "1px solid #e4efff" }}>
                    {["UID Mesin", "Nama di Mesin", "Mesin", "Kemungkinan Pejuang", ...(isSuperAdmin ? ["Aksi"] : [])].map((label) => (
                      <th key={label} style={{ padding: "12px 20px", textAlign: "left", fontSize: "12px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unregistered.map((item) => (
                    <tr key={enrollmentKey(item)} style={{ borderBottom: "1px solid #f0f4ff" }}>
                      <td style={{ padding: "12px 20px", width: "1%" }}>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", background: "var(--color-surface-container-high)", color: "var(--color-primary)", padding: "3px 10px", borderRadius: "6px", fontWeight: 600 }}>{item.device_uid}</span>
                      </td>
                      <td style={{ padding: "12px 20px", fontSize: "14px", color: item.name ? "var(--color-on-background)" : "var(--color-outline)" }}>
                        {item.name || "(tanpa nama di mesin)"}
                      </td>
                      <td style={{ padding: "12px 20px" }}><span style={chipStyle}>{item.device_name}</span></td>
                      <td style={{ padding: "12px 20px", fontSize: "13px", color: item.suggestion ? "var(--color-on-background)" : "var(--color-outline-variant)" }}>
                        {item.suggestion ? `${item.suggestion.name} (#${item.suggestion.uid})` : "—"}
                      </td>
                      {isSuperAdmin && (
                        <td style={{ padding: "12px 20px", width: "1%" }}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => openLinkModal(item)} style={smallButtonStyle} title="Hubungkan ke Pejuang yang sudah ada">
                              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>link</span>
                              Hubungkan
                            </button>
                            <button onClick={() => openAddModal(item)} style={smallButtonStyle} title="Tambahkan sebagai Pejuang baru">
                              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>person_add</span>
                              Tambahkan
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
        )}
      </div>

      {/* ── Add Employee Modal ───────────────────────────────────────────── */}
      <Modal isOpen={addModal} onClose={() => setAddModal(false)} title="Tambah Pejuang Baru" size="sm">
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {formData.link && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", background: "var(--color-surface-container)", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "var(--color-primary)" }}>link</span>
              Dihubungkan ke UID {formData.link.device_uid} di mesin {formData.link.device_name}
            </div>
          )}
          {[
            formData.link
              ? { key: "uid", label: "Nomor Pejuang (opsional)", type: "number", placeholder: "Kosongkan agar dipilih otomatis", required: false }
              : { key: "uid", label: "Nomor Pejuang", type: "number", placeholder: "contoh: 5", required: true },
            { key: "name", label: "Nama Lengkap", type: "text", placeholder: "Nama Pejuang", required: true },
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
      <Modal isOpen={editModal.open} onClose={() => setEditModal({ open: false, employee: null })} title="Edit Data Pejuang" size="sm">
        <form onSubmit={handleEditSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {[
            { key: "uid", label: "Nomor Pejuang", type: "number", disabled: true },
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

            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Mesin Presensi</label>
              <select required value={leaveModal.deviceId} onChange={e => setLeaveModal({ ...leaveModal, deviceId: e.target.value })}
                style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", boxSizing: "border-box" }}>
                <option value="">Pilih mesin presensi</option>
                {devices.map((item) => <option key={item.id} value={item.id}>{deviceLabel(item)}</option>)}
              </select>
              <small style={{ display: "block", marginTop: "5px", color: "var(--color-outline)", fontSize: "11px" }}>
                Izin/cuti tampil di laporan mesin yang dipilih di sini.
              </small>
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

      {/* ── Bulk Register Modal ──────────────────────────────────────────── */}
      <Modal isOpen={bulkModal.open} onClose={() => setBulkModal({ ...bulkModal, open: false })} title="Daftarkan User Mesin" size="sm">
        <form onSubmit={handleBulkSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--color-outline)", lineHeight: 1.6 }}>
            User yang dicentang didaftarkan sebagai Pejuang baru memakai nama di mesin. Hapus centang akun yang bukan orang (misalnya &quot;Admin&quot;).
            User yang mirip Pejuang yang sudah ada tidak dicentang; sebaiknya dihubungkan agar tidak tercatat dua kali.
            {unregistered.length > registerable.length && ` ${unregistered.length - registerable.length} UID tanpa nama di mesin tidak ikut; tambahkan satu per satu.`}
          </p>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Departemen (opsional)</label>
            <input type="text" maxLength={255} placeholder="Kosongkan untuk diisi nanti" value={bulkModal.department}
              onChange={e => setBulkModal({ ...bulkModal, department: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ border: "1px solid var(--color-outline-variant)", borderRadius: "10px", overflow: "hidden" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "var(--color-background)", borderBottom: "1px solid var(--color-outline-variant)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={bulkModal.selected.length === registerable.length}
                onChange={e => setBulkModal({ ...bulkModal, selected: e.target.checked ? registerable.map(enrollmentKey) : [] })} />
              Pilih semua ({bulkModal.selected.length}/{registerable.length})
            </label>
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {registerable.map((item) => (
                <label key={enrollmentKey(item)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 14px", borderBottom: "1px solid #f0f4ff", fontSize: "13px", cursor: "pointer" }}>
                  <input type="checkbox" checked={bulkModal.selected.includes(enrollmentKey(item))} onChange={() => toggleBulkKey(enrollmentKey(item))} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "var(--color-primary)", minWidth: "36px" }}>{item.device_uid}</span>
                  <span style={{ flex: 1, color: "var(--color-on-background)" }}>
                    {item.name}
                    {item.suggestion && <span style={{ display: "block", fontSize: "11px", color: "#a16207" }}>mirip Pejuang {item.suggestion.name} (#{item.suggestion.uid})</span>}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--color-outline)" }}>{item.device_name}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setBulkModal({ ...bulkModal, open: false })} style={{
              padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
              background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
            }}>Batal</button>
            <button type="submit" disabled={isSubmitting || bulkModal.selected.length === 0} style={{
              padding: "10px 18px", background: "var(--color-primary)", border: "none",
              borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
              cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              opacity: isSubmitting || bulkModal.selected.length === 0 ? 0.6 : 1,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>group_add</span>
              {isSubmitting ? "Mendaftarkan..." : `Daftarkan ${bulkModal.selected.length} Pejuang`}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Link Machine User Modal ───────────────────────────────────────── */}
      <Modal isOpen={linkModal.open} onClose={() => setLinkModal({ ...linkModal, open: false })} title="Hubungkan ke Pejuang" size="sm">
        {linkModal.item && (
          <form onSubmit={handleLinkSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ padding: "10px 12px", background: "var(--color-surface-container)", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)" }}>
              UID <strong>{linkModal.item.device_uid}</strong> di mesin <strong>{linkModal.item.device_name}</strong>
              {linkModal.item.name ? <> (nama di mesin: <strong>{linkModal.item.name}</strong>)</> : " (tanpa nama di mesin)"}
            </div>
            <input type="text" placeholder="Cari nama atau nomor Pejuang..." value={linkModal.filter}
              onChange={e => setLinkModal({ ...linkModal, filter: e.target.value })} style={fieldStyle} />
            <select required size={8} value={linkModal.employeeUid} onChange={e => setLinkModal({ ...linkModal, employeeUid: e.target.value })}
              style={{ ...fieldStyle, padding: "6px" }}>
              {allEmployees
                .filter((emp) => {
                  const term = linkModal.filter.trim().toLowerCase();
                  return !term || emp.name.toLowerCase().includes(term) || String(emp.uid).includes(term) || String(emp.uid) === linkModal.employeeUid;
                })
                .map((emp) => (
                  <option key={emp.uid} value={emp.uid}>
                    #{emp.uid} {emp.name}{emp.department ? ` — ${emp.department}` : ""}{emp.devices?.length ? ` [${emp.devices.map((d) => d.name).join(", ")}]` : ""}
                  </option>
                ))}
            </select>
            <small style={{ color: "var(--color-outline)", fontSize: "12px" }}>
              Scan UID ini di mesin {linkModal.item.device_name} akan tercatat atas nama Pejuang yang dipilih, termasuk scan lama.
            </small>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setLinkModal({ ...linkModal, open: false })} style={{
                padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
                background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
              }}>Batal</button>
              <button type="submit" disabled={isSubmitting || !linkModal.employeeUid} style={{
                padding: "10px 18px", background: "var(--color-primary)", border: "none",
                borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                opacity: isSubmitting || !linkModal.employeeUid ? 0.6 : 1,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>link</span>
                {isSubmitting ? "Menyimpan..." : "Hubungkan"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Unlink Confirmation Modal ─────────────────────────────────────── */}
      <Modal isOpen={unlinkModal.open} onClose={() => setUnlinkModal({ open: false, employee: null, device: null })} title="Lepas dari Mesin" size="sm">
        {unlinkModal.device && (
          <>
            <p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--color-on-background)", lineHeight: 1.6 }}>
              Lepas UID <strong>{unlinkModal.device.device_uid}</strong> di mesin <strong>{unlinkModal.device.name}</strong>
              {unlinkModal.device.machine_name ? <> (&quot;{unlinkModal.device.machine_name}&quot;)</> : null} dari Pejuang <strong>{unlinkModal.employee?.name}</strong>?
              Scan UID itu di mesin tersebut tidak lagi tercatat atas nama {unlinkModal.employee?.name}, dan user mesinnya kembali ke daftar belum terdaftar.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => setUnlinkModal({ open: false, employee: null, device: null })} style={{
                padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px",
                background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
              }}>Batal</button>
              <button onClick={handleUnlink} disabled={isSubmitting} style={{
                padding: "10px 18px", background: "var(--color-error)", border: "none",
                borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", opacity: isSubmitting ? 0.6 : 1,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>link_off</span>
                Lepas
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ────────────────────────────────────── */}
      <Modal isOpen={deleteModal.open} onClose={() => setDeleteModal({ open: false, employee: null })} title="Hapus Pejuang" size="sm">
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
          Data Pejuang ini akan dihapus secara permanen dari sistem. Riwayat scan di mesin tetap tersimpan.
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
