"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/app/components/DashboardShell";
import AttendanceChart from "@/app/components/AttendanceChart";
import DeviceSelect, { useSelectedDevice } from "@/app/components/DeviceSelect";
import { useRealtimeStream } from "@/app/components/useRealtimeStream";
import { useParams } from "next/navigation";
import Modal from "@/app/components/Modal";

function todayInJakarta() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function EmployeeProfile() {
  const { uid } = useParams();
  const { devices, deviceId, setDeviceId, loaded: devicesLoaded } = useSelectedDevice();
  const [employee, setEmployee] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [canManageAttendance, setCanManageAttendance] = useState(false);
  const [absenceModal, setAbsenceModal] = useState({ open: false, type: "Izin", date: todayInJakarta(), reason: "", error: "" });
  const [isSavingAbsence, setIsSavingAbsence] = useState(false);
  const [period, setPeriod] = useState("weekly");
  const [recap, setRecap] = useState({ loading: false, data: null, error: "" });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.ok ? response.json() : null)
      .then((json) => setCanManageAttendance(["superadmin", "sdm"].includes(json?.user?.role)))
      .catch(() => setCanManageAttendance(false));
  }, []);

  const fetchData = useCallback(async () => {
    if (!devicesLoaded) return;
    setIsLoading(true);
    try {
      // 1. Get Employee Info
      const empRes = await fetch(`/api/employees`);
      if (empRes.ok) {
        const empJson = await empRes.json();
        const found = empJson.data.find(e => String(e.uid) === uid);
        setEmployee(found || { uid, name: "Tidak Ditemukan", department: "-", devices: [] });
      }

    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [uid, deviceId, devicesLoaded]);

  const saveAbsence = async (event) => {
    event.preventDefault();
    if (!deviceId) return;
    setIsSavingAbsence(true);
    setAbsenceModal((current) => ({ ...current, error: "" }));
    try {
      const res = await fetch(`/api/leaves?device_id=${encodeURIComponent(deviceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, date: absenceModal.date, type: absenceModal.type, reason: absenceModal.reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Keterangan gagal disimpan.");
      setAbsenceModal({ open: false, type: "Izin", date: todayInJakarta(), reason: "", error: "" });
      await fetchData();
    } catch (error) {
      setAbsenceModal((current) => ({ ...current, error: error.message || "Keterangan gagal disimpan." }));
    } finally {
      setIsSavingAbsence(false);
    }
  };

  const loadRecap = useCallback(async () => {
    if (!deviceId) return;
    setRecap({ loading: true, data: null, error: "" });
    try {
      const res = await fetch(`/api/employees/${encodeURIComponent(uid)}/recap?device_id=${encodeURIComponent(deviceId)}&period=${period}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Rekap gagal dimuat.");
      setChartData(json.daily.map((day) => ({
        date: day.date,
        hadir: day.status === "Hadir" ? 1 : 0,
        izin: day.status === "Izin" ? 1 : 0,
        sakit: day.status === "Sakit" ? 1 : 0,
        cuti: day.status === "Cuti" ? 1 : 0,
        alfa: day.status === "Alfa" ? 1 : 0,
      })));
      const logsRes = await fetch(`/api/logs?employee_uid=${encodeURIComponent(uid)}&device_id=${encodeURIComponent(deviceId)}&date_from=${json.range.from}&date_to=${json.range.to}&limit=100`, { cache: "no-store" });
      const logsJson = await logsRes.json().catch(() => ({}));
      if (!logsRes.ok) throw new Error(logsJson.error || "Riwayat periode gagal dimuat.");
      setLogs(logsJson.data || []);
      setRecap({ loading: false, data: json, error: "" });
    } catch (error) {
      setChartData([]);
      setLogs([]);
      setRecap({ loading: false, data: null, error: error.message || "Rekap gagal dimuat." });
    }
  }, [uid, deviceId, period]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    loadRecap();
  }, [fetchData, loadRecap]);

  useRealtimeStream((event) => {
    if (["employees", "attendance", "sync", "leaves", "devices"].includes(event.type)) {
      fetchData();
      loadRecap();
    }
  });

  return (
    <DashboardShell>
      <div className="dashboard-container">
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px", padding: "0 4px" }}>
          <div>
            <h1 style={{ margin: "0 0 8px", fontSize: "28px", fontWeight: 700, color: "var(--color-on-background)", letterSpacing: "-0.02em" }}>
              Profil Pejuang
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--color-outline)" }}>
              Detail riwayat dan statistik kehadiran per mesin.
            </p>
            <div style={{ marginTop: "12px" }}>
              <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} />
            </div>
          </div>
          <button onClick={() => window.history.back()} style={{
            display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px",
            background: "var(--color-surface)", border: "1px solid #c3c6d6", borderRadius: "10px",
            fontSize: "14px", fontWeight: 600, color: "var(--color-on-background)", cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>arrow_back</span>
            Kembali
          </button>
        </div>

        {isLoading ? (
           <p style={{ color: "var(--color-outline)", fontSize: "14px" }}>Memuat profil...</p>
        ) : !employee ? (
           <p style={{ color: "var(--color-error)", fontSize: "14px" }}>Pejuang tidak ditemukan.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "24px", alignItems: "start" }}>
            
            {/* Kartu Profil */}
            <div className="glass-card" style={{ borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
              <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", fontWeight: 700, color: "var(--color-surface)", marginBottom: "16px" }}>
                {employee.name ? employee.name.charAt(0) : "?"}
              </div>
              <h2 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 700, color: "var(--color-on-background)" }}>
                {employee.name}
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace" }}>
                UID: {employee.uid}
              </p>
              
              <div style={{ width: "100%", background: "var(--color-surface-container-low)", borderRadius: "12px", padding: "16px", textAlign: "left" }}>
                <p style={{ margin: "0 0 4px", fontSize: "11px", color: "var(--color-outline)", textTransform: "uppercase", fontWeight: 600 }}>Departemen</p>
                <p style={{ margin: "0", fontSize: "14px", fontWeight: 500, color: "var(--color-on-background)" }}>{employee.department || "-"}</p>
                <p style={{ margin: "12px 0 4px", fontSize: "11px", color: "var(--color-outline)", textTransform: "uppercase", fontWeight: 600 }}>Tercatat di Mesin</p>
                <p style={{ margin: "0", fontSize: "14px", fontWeight: 500, color: "var(--color-on-background)" }}>
                  {employee.devices?.length ? employee.devices.map((item) => `${item.name} (UID ${item.device_uid})`).join(", ") : "-"}
                </p>
              </div>
              <div style={{ width: "100%", marginTop: "16px", display: "grid", gap: "8px" }}>
                {canManageAttendance && <button type="button" onClick={() => setAbsenceModal((current) => ({ ...current, open: true }))} style={{ padding: "10px 12px", border: "1px solid var(--color-primary)", borderRadius: "8px", background: "transparent", color: "var(--color-primary)", fontWeight: 700, cursor: "pointer" }}>Beri Keterangan</button>}
              </div>
            </div>

            {/* Statistik */}
            <div className="glass-card" style={{ borderRadius: "16px", padding: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Statistik {period === "monthly" ? "Bulanan" : "Mingguan"}</h2>
                </div>
                <div style={{ display: "flex", gap: "8px" }}><button type="button" onClick={() => setPeriod("weekly")} disabled={recap.loading} style={{ padding: "7px 10px", border: "none", borderRadius: "7px", background: period === "weekly" ? "var(--color-primary)" : "var(--color-surface-container-high)", color: period === "weekly" ? "var(--color-on-primary)" : "var(--color-on-background)", cursor: "pointer" }}>Mingguan</button><button type="button" onClick={() => setPeriod("monthly")} disabled={recap.loading} style={{ padding: "7px 10px", border: "none", borderRadius: "7px", background: period === "monthly" ? "var(--color-primary)" : "var(--color-surface-container-high)", color: period === "monthly" ? "var(--color-on-primary)" : "var(--color-on-background)", cursor: "pointer" }}>Bulanan</button></div>
              </div>
              <AttendanceChart data={chartData} />
              {recap.error && <p role="alert" style={{ color: "var(--color-error)", fontSize: "13px" }}>{recap.error}</p>}
              {recap.data && <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>{Object.entries(recap.data.summary).map(([key, value]) => <span key={key} style={{ padding: "5px 9px", borderRadius: "12px", background: "var(--color-surface-container-high)", fontSize: "12px" }}>{key.replace("_", " ")}: <strong>{value}</strong></span>)}</div>}
            </div>

            {/* Riwayat Terakhir */}
            <div className="glass-card" style={{ borderRadius: "16px", padding: "24px", gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Riwayat {period === "monthly" ? "Bulanan" : "Mingguan"}</h2>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e4efff" }}>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", fontWeight: 600 }}>Waktu</th>
                      <th style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", fontWeight: 600 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan="2" style={{ padding: "24px", textAlign: "center", color: "var(--color-outline)" }}>Belum ada rekaman</td>
                      </tr>
                    ) : logs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: "1px solid #eef4ff" }}>
                        <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace" }}>
                          {new Date(log.timestamp).toLocaleString("id-ID")}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-on-background)", fontWeight: 600 }}>
                          Sukses
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </div>
      <Modal isOpen={absenceModal.open} onClose={() => setAbsenceModal({ open: false, type: "Izin", date: todayInJakarta(), reason: "", error: "" })} title="Keterangan Kehadiran" size="sm">
        <form onSubmit={saveAbsence} style={{ display: "grid", gap: "14px" }}>
          <label>Tanggal<input required type="date" value={absenceModal.date} onChange={(event) => setAbsenceModal((current) => ({ ...current, date: event.target.value }))} style={{ display: "block", width: "100%", marginTop: "6px", padding: "8px", boxSizing: "border-box" }} /></label>
          <label>Keterangan<select value={absenceModal.type} onChange={(event) => setAbsenceModal((current) => ({ ...current, type: event.target.value }))} style={{ display: "block", width: "100%", marginTop: "6px", padding: "8px" }}><option>Izin</option><option>Sakit</option><option>Alfa</option></select></label>
          <label>Catatan<textarea value={absenceModal.reason} onChange={(event) => setAbsenceModal((current) => ({ ...current, reason: event.target.value }))} maxLength={1000} rows={3} style={{ display: "block", width: "100%", marginTop: "6px", padding: "8px", boxSizing: "border-box" }} /></label>
          {absenceModal.error && <p style={{ margin: 0, color: "var(--color-error)" }}>{absenceModal.error}</p>}
          <button disabled={isSavingAbsence} type="submit" style={{ padding: "10px", border: "none", borderRadius: "8px", background: "var(--color-primary)", color: "var(--color-on-primary)", fontWeight: 700, cursor: "pointer" }}>{isSavingAbsence ? "Menyimpan..." : "Simpan Keterangan"}</button>
        </form>
      </Modal>
      <style>{`
        .dashboard-container { padding: 20px 40px 80px; max-width: 1440px; margin: 0 auto; }
        @media (max-width: 767px) {
          .dashboard-container { padding: 20px 16px 80px; }
          .glass-card { grid-column: 1 / -1 !important; }
        }
      `}</style>
    </DashboardShell>
  );
}
