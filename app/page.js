"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import DashboardShell from "@/app/components/DashboardShell";
import Modal from "@/app/components/Modal";
import AttendanceChart from "@/app/components/AttendanceChart";
import DeviceSelect, { useSelectedDevice } from "@/app/components/DeviceSelect";
import { useRealtimeStream } from "@/app/components/useRealtimeStream";

// "2026-10-17 10:25:59" -> "17/10/2026 10:25"
function formatScanTime(value) {
  if (!value) return "belum ada";
  const [date, time = ""] = value.split(" ");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time.slice(0, 5)}`;
}

function todayInJakarta() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function Home() {
  const [timeStr, setTimeStr] = useState("00:00:00 WIB");
  const [logs, setLogs] = useState([]);
  const [report, setReport] = useState([]);
  const [metrics, setMetrics] = useState({ totalScansToday: 0, authorized: 0, unauthorized: 0 });
  const [isSyncing, setIsSyncing] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({ col: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [missingAttendance, setMissingAttendance] = useState([]);
  const [attendanceStatusModal, setAttendanceStatusModal] = useState({ open: false, employee: null, type: "Izin", reason: "", error: "" });
  const [isSavingAttendanceStatus, setIsSavingAttendanceStatus] = useState(false);
  const [syncModal, setSyncModal] = useState({ open: false, message: "", success: null });
  const [exportModal, setExportModal] = useState({ open: false, dateFrom: "", dateTo: "", department: "", format: "excel" });
  const [welcomeModal, setWelcomeModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [machineStatus, setMachineStatus] = useState({ online: true, ip: "Memeriksa..." });
  const [chartData, setChartData] = useState([]);
  const [chartError, setChartError] = useState("");
  const { devices, deviceId: selectedDeviceId, setDeviceId: setSelectedDeviceId } = useSelectedDevice();
  const [canSync, setCanSync] = useState(false);
  const [syncJobId, setSyncJobId] = useState("");

  // Clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }) + " WIB");
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  // Check Welcome on Mount
  useEffect(() => {
    if (sessionStorage.getItem("showWelcome") === "true") {
      // Nilai berasal dari session browser dan hanya diterapkan saat mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWelcomeModal(true);
    }
  }, []);

  const handleCloseWelcome = () => {
    setWelcomeModal(false);
    sessionStorage.removeItem("showWelcome");
  };

  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => response.ok ? response.json() : null)
      .then((json) => setCanSync(['superadmin', 'sdm'].includes(json?.user?.role)))
      .catch(() => setCanSync(false));
  }, []);

  // Fetch logs
  const fetchLogs = useCallback(async (isSilent = false) => {
    if (!selectedDeviceId) return;
    if (!isSilent) setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDate) params.append("date", filterDate);
      if (filterSearch) params.append("search", filterSearch);
      params.append("sortCol", sortConfig.col);
      params.append("sortDir", sortConfig.dir);
      params.append("page", page.toString());
      params.append("limit", pageSize.toString());
      params.append("device_id", selectedDeviceId);
      const res = await fetch("/api/logs?" + params.toString());
      if (!res.ok) return;
      const json = await res.json();
      if (json.data)    setLogs(json.data);
      if (json.report)  setReport(json.report);
      setMissingAttendance(json.missingAttendance || []);
      if (json.metrics) setMetrics(json.metrics);
      if (json.pagination) {
        setTotalPages(json.pagination.totalPages || 1);
        setTotalItems(json.pagination.totalItems || 0);
      }
    } catch (e) { 
      console.error(e); 
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [filterDate, filterSearch, sortConfig, page, pageSize, selectedDeviceId]);

  // Fetch machine status
  const fetchMachineStatus = useCallback(async () => {
    if (!selectedDeviceId) return;
    try {
      const res = await fetch(`/api/machine/status?device_id=${selectedDeviceId}`);
      if (res.ok) {
        const data = await res.json();
        setMachineStatus(data);
      } else {
        setMachineStatus(s => ({ ...s, online: false }));
      }
    } catch (e) {
      setMachineStatus(s => ({ ...s, online: false }));
    }
  }, [selectedDeviceId]);

  const fetchChartData = useCallback(async () => {
    if (!selectedDeviceId) return;
    try {
      setChartError("");
      const res = await fetch(`/api/stats?device_id=${selectedDeviceId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Statistik gagal dimuat.");
      setChartData(json.data || []);
    } catch (e) {
      console.error(e);
      setChartData([]);
      setChartError(e.message || "Statistik gagal dimuat.");
    }
  }, [selectedDeviceId]);

  // Sinkronisasi hanya dimulai secara eksplisit oleh operator. Membuka dashboard
  // tidak boleh menarik dump log seluruh mesin atau mengganggu listener realtime.
  const manualSyncRef = useRef(false);

  useEffect(() => {
    if (!selectedDeviceId) return;
    // Initial fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
    fetchMachineStatus();
    fetchChartData();
  }, [fetchLogs, fetchMachineStatus, fetchChartData, selectedDeviceId]);

  // Dengarkan perubahan real-time via Server-Sent Events (SSE) tanpa delay
  useRealtimeStream((event) => {
    if (!selectedDeviceId) return;
    if (event.type === "sync_job" && event.job?.id === syncJobId) {
      const job = event.job;
      setIsSyncing(false);
      setSyncJobId("");
      fetchLogs(true);
      fetchChartData();
      if (syncModal.open) {
        setSyncModal({
          open: true,
          success: job.failed === 0,
          message: job.failed === 0
            ? `Sinkronisasi selesai. ${job.succeeded}/${job.total} mesin berhasil diperbarui.`
            : `Sinkronisasi selesai dengan kendala. ${job.succeeded}/${job.total} mesin berhasil, ${job.failed} mesin gagal.`,
          diagnostics: null,
        });
      }
      return;
    }
    if (event.type === "machine_status") {
      if (!event.device_id || String(event.device_id) === String(selectedDeviceId)) {
        setMachineStatus((prev) => ({ ...prev, online: Boolean(event.online) }));
      }
      return;
    }
    if (["attendance", "sync", "employees", "leaves"].includes(event.type)) {
      if (!event.device_id || String(event.device_id) === String(selectedDeviceId)) {
        fetchLogs(true);
        fetchChartData();
      }
    }
  });

  // Satu sinkronisasi master untuk semua mesin. Server mengembalikan 202 agar
  // reverse proxy tidak menunggu pembacaan log ZKTeco yang berukuran besar.
  async function handleSync() {
    if (manualSyncRef.current) return;
    manualSyncRef.current = true;
    setIsSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Server merespons ${res.status}.`);
      setSyncJobId(json.job?.id || "");

      setSyncModal({
        open: true,
        success: true,
        message: `${json.message || "Sinkronisasi dimulai."}\n${json.job?.completed || 0}/${json.job?.total || 0} mesin selesai diproses.`,
        diagnostics: null,
      });
    } catch (e) {
      setSyncModal({ open: true, success: false, message: e.message || "Koneksi ke server gagal." });
      setIsSyncing(false);
    } finally {
      manualSyncRef.current = false;
    }
  }

  const openAttendanceStatusModal = (employee) => {
    setAttendanceStatusModal({
      open: true,
      employee,
      type: employee.status_type || "Izin",
      reason: employee.status_reason || "",
      error: "",
    });
  };

  const saveAttendanceStatus = async (event) => {
    event.preventDefault();
    if (!selectedDeviceId || !attendanceStatusModal.employee) return;
    setIsSavingAttendanceStatus(true);
    setAttendanceStatusModal((current) => ({ ...current, error: "" }));
    try {
      const res = await fetch(`/api/leaves?device_id=${encodeURIComponent(selectedDeviceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: attendanceStatusModal.employee.uid,
          date: filterDate || todayInJakarta(),
          type: attendanceStatusModal.type,
          reason: attendanceStatusModal.reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Keterangan gagal disimpan.");
      setAttendanceStatusModal({ open: false, employee: null, type: "Izin", reason: "", error: "" });
      await fetchLogs(true);
      await fetchChartData();
    } catch (error) {
      setAttendanceStatusModal((current) => ({ ...current, error: error.message || "Keterangan gagal disimpan." }));
    } finally {
      setIsSavingAttendanceStatus(false);
    }
  };

  // Excel / PDF download
  const handleExportSubmit = async (e) => {
    e.preventDefault();
    try {
      const params = new URLSearchParams();
      if (exportModal.dateFrom)  params.append("date_from",  exportModal.dateFrom);
      if (exportModal.dateTo)    params.append("date_to",    exportModal.dateTo);
      if (exportModal.department) params.append("department", exportModal.department);
      if (!selectedDeviceId) return;
      params.append("device_id", selectedDeviceId);

      if (exportModal.format === 'pdf') {
        // Buka halaman PDF bersih di tab baru — user klik "Cetak / Simpan PDF"
        window.open("/api/pdf?" + params.toString(), "_blank");
        setExportModal({ ...exportModal, open: false });
        return;
      }

      // Excel
      window.open("/api/export?" + params.toString(), "_blank");
      setExportModal({ ...exportModal, open: false });
    } catch (e) { console.error(e); }
  };

  const authPct   = metrics.totalScansToday > 0 ? ((metrics.authorized   / metrics.totalScansToday) * 100).toFixed(1) : "0.0";
  const unauthPct = metrics.totalScansToday > 0 ? ((metrics.unauthorized / metrics.totalScansToday) * 100).toFixed(1) : "0.0";
  const gaugeOffset = 282.7 - (282.7 * (metrics.totalScansToday > 0 ? Math.min(metrics.authorized / (metrics.totalScansToday || 1), 1) : 0));

  return (
    <DashboardShell metrics={metrics}>
      <div className="dashboard-container" style={{ display: "flex", flexDirection: "column" }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px", marginBottom: "24px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "36px", fontWeight: 700, color: "var(--color-on-background)", letterSpacing: "-0.02em" }}>Ringkasan Dashboard</h1>
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Waktu Sistem: {timeStr}
            </p>
            <div style={{ marginTop: "12px" }}>
              <DeviceSelect devices={devices} value={selectedDeviceId} onChange={(value) => { setSelectedDeviceId(value); setPage(1); }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "var(--color-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", background: "var(--color-surface-container-high)", padding: "6px 12px", borderRadius: "20px" }}>
              <span className="status-pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-primary)" }} />
              Realtime Live-Stream Aktif
            </span>
            {canSync && <>
            <button onClick={() => handleSync(false)} disabled={isSyncing} aria-busy={isSyncing}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", background: "var(--color-primary)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)", cursor: isSyncing ? "wait" : "pointer", opacity: isSyncing ? 0.78 : 1, transition: "opacity 0.2s", boxShadow: "0 2px 8px rgba(0,61,155,0.3)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px", animation: isSyncing ? "spin 1s linear infinite" : "none" }}>{isSyncing ? "progress_activity" : "sync"}</span>
              {isSyncing ? "Sedang menyinkronkan..." : "Sinkronkan Semua Mesin"}
            </button>
            </>}
          </div>
        </div>

        {/* ── Metric Cards ───────────────────────────────────────────────── */}
        <div className="metrics-grid">

          {/* Network Status */}
          <div className="glass-card span-8" style={{ borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <p style={{ margin: "0 0 6px", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Status Jaringan</p>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div className={machineStatus.online ? "status-pulse" : ""} style={{ width: "12px", height: "12px", borderRadius: "50%", background: machineStatus.online ? "var(--color-primary)" : "var(--color-error)" }} />
                  <span style={{ fontSize: "24px", fontWeight: 600, color: machineStatus.online ? "var(--color-primary)" : "var(--color-error)", letterSpacing: "-0.01em" }}>
                    {machineStatus.online ? "Sistem Aman" : "Mesin Terputus"}
                  </span>
                </div>
              </div>
              <span className="material-symbols-outlined" style={{ fontSize: "36px", color: machineStatus.online ? "var(--color-outline-variant)" : "var(--color-error)", fontVariationSettings: "'FILL' 0" }}>
                {machineStatus.online ? "shield_locked" : "warning"}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "24px", borderTop: "1px solid #c3c6d6", paddingTop: "20px" }}>
              <div>
                <p style={{ margin: "0 0 4px", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Titik Aktif</p>
                <p style={{ margin: 0, fontSize: "20px", fontWeight: 600, color: "var(--color-on-background)" }}>{selectedDeviceId ? '1' : '0'}</p>
              </div>
              <div>
                <p style={{ margin: "0 0 4px", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Status Koneksi</p>
                <span style={{ 
                  display: "inline-flex", alignItems: "center", padding: "4px 14px", borderRadius: "20px", 
                  background: machineStatus.online ? "var(--color-surface-container-high)" : "var(--color-error-container)", 
                  border: `1px solid ${machineStatus.online ? "#c3c6d6" : "var(--color-error)"}`, 
                  fontSize: "12px", fontFamily: "'JetBrains Mono', monospace", 
                  color: machineStatus.online ? "var(--color-on-background)" : "var(--color-error)" 
                }}>
                  {machineStatus.online ? "Terhubung" : "Gagal Akses"}
                </span>
              </div>
            </div>
          </div>

          {/* Gauge */}
          <div className="glass-card span-4" style={{ borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <p style={{ position: "absolute", top: "20px", left: "20px", margin: 0, fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Pindaian Hari Ini</p>
            <div style={{ position: "relative", width: "140px", height: "140px", marginTop: "24px" }}>
              <svg style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }} viewBox="0 0 100 100">
                <circle cx="50" cy="50" fill="none" r="45" stroke="var(--color-surface-container-highest)" strokeDasharray="282.7" strokeDashoffset="0" strokeWidth="8" />
                <circle cx="50" cy="50" fill="none" r="45" stroke="var(--color-primary)" strokeDasharray="282.7" strokeDashoffset={gaugeOffset} strokeWidth="8" style={{ transition: "stroke-dashoffset 1s ease" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-on-background)" }}>{metrics.totalScansToday}</span>
                <span style={{ fontSize: "10px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>TOTAL</span>
              </div>
            </div>
          </div>

          {/* Authorized */}
          <div className="glass-card span-4" style={{ borderRadius: "16px", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-primary)", fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Berhasil Dikenali</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "36px", fontWeight: 700, color: "var(--color-on-background)", letterSpacing: "-0.02em" }}>{metrics.authorized}</span>
              <span style={{ fontSize: "12px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace" }}>{authPct}%</span>
            </div>
            <div style={{ width: "100%", height: "6px", background: "var(--color-surface-container-high)", borderRadius: "4px", marginTop: "16px", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--color-primary)", width: `${authPct}%`, transition: "width 0.5s ease", borderRadius: "4px" }} />
            </div>
          </div>

          {/* Unauthorized */}
          <div className="glass-card span-4" style={{ borderRadius: "16px", padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--color-error)", fontVariationSettings: "'FILL' 1" }}>cancel</span>
              <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Tidak Dikenali</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
              <span style={{ fontSize: "36px", fontWeight: 700, color: "var(--color-error)", letterSpacing: "-0.02em" }}>{metrics.unauthorized}</span>
              <span style={{ fontSize: "12px", color: "var(--color-outline)", fontFamily: "'JetBrains Mono', monospace" }}>{unauthPct}%</span>
            </div>
            <div style={{ width: "100%", height: "6px", background: "var(--color-error-container)", borderRadius: "4px", marginTop: "16px", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "var(--color-error)", width: `${unauthPct}%`, transition: "width 0.5s ease", borderRadius: "4px" }} />
            </div>
          </div>

          {/* Live Feed */}
          <div className="glass-card span-4" style={{ borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Aktivitas Terkini</span>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <span style={{ position: "absolute", display: "inline-flex", width: "100%", height: "100%", borderRadius: "50%", background: "var(--color-primary)", opacity: 0.75, animation: "ping 1s cubic-bezier(0,0,0.2,1) infinite" }} />
                <span style={{ position: "relative", display: "inline-flex", width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-primary)" }} />
              </span>
            </div>
            <div style={{ overflowY: "auto", maxHeight: "280px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={`skel-feed-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: "10px", paddingBottom: "12px", borderBottom: "1px solid #e4efff" }}>
                    <div className="skeleton" style={{ width: "20px", height: "20px", borderRadius: "50%" }}></div>
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ width: "70%", height: "14px", borderRadius: "4px", marginBottom: "6px" }}></div>
                      <div className="skeleton" style={{ width: "40%", height: "10px", borderRadius: "4px" }}></div>
                    </div>
                    <div className="skeleton" style={{ width: "30px", height: "16px", borderRadius: "6px" }}></div>
                  </div>
                ))
              ) : logs.length === 0 ? (
                <p style={{ color: "var(--color-outline)", fontSize: "13px", textAlign: "center", padding: "16px 0" }}>Belum ada data rekaman</p>
              ) : logs.map((log) => {
                const isAuth = !!log.name;
                return (
                  <div key={log.id} style={{ display: "flex", alignItems: "flex-start", gap: "10px", paddingBottom: "12px", borderBottom: "1px solid #e4efff" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "16px", marginTop: "2px", color: isAuth ? "var(--color-primary)" : "var(--color-error)", fontVariationSettings: "'FILL' 1" }}>
                      {isAuth ? "fingerprint" : "warning"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: isAuth ? "var(--color-on-background)" : "var(--color-error)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'JetBrains Mono', monospace" }}>
                        {isAuth ? log.name : `UID: ${log.device_uid}`}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--color-outline)" }}>
                        {new Date(log.timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                      </p>
                    </div>
                    <span style={{
                      fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600,
                      padding: "3px 8px", borderRadius: "6px", flexShrink: 0,
                      color: isAuth ? "var(--color-primary)" : "var(--color-error)",
                      background: isAuth ? "rgba(5,150,105,0.08)" : "rgba(239,68,68,0.08)",
                      border: `1px solid ${isAuth ? "rgba(5,150,105,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}>
                      {isAuth ? "OK" : "???"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Chart Row ─────────────────────────────────────────────── */}
        <div className="glass-card" style={{ borderRadius: "16px", padding: "24px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Statistik Harian (7 Hari Terakhir)</h2>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-outline)" }}>Ringkasan kehadiran, cuti, izin, sakit, dan alfa Pejuang.</p>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: "24px", color: "var(--color-outline-variant)" }}>bar_chart</span>
          </div>
          {chartError ? (
            <div role="alert" style={{ minHeight: "220px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-error)", fontSize: "13px", textAlign: "center" }}>
              {chartError}
            </div>
          ) : (
            <AttendanceChart data={chartData} />
          )}
        </div>

        <div className="glass-card" style={{ order: 2, borderRadius: "16px", padding: "24px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Pejuang Belum Tap Finger</h2>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-outline)" }}>
                {filterDate ? `Tanggal ${new Date(`${filterDate}T00:00:00`).toLocaleDateString("id-ID")}` : "Hari ini"} · {missingAttendance.length} Pejuang belum tercatat hadir.
              </p>
            </div>
            <span style={{ minWidth: "32px", height: "32px", padding: "0 10px", borderRadius: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: missingAttendance.length ? "var(--color-error-container)" : "rgba(5,150,105,0.1)", color: missingAttendance.length ? "var(--color-error)" : "var(--color-primary)", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
              {missingAttendance.length}
            </span>
          </div>

          {missingAttendance.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--color-outline)", fontSize: "13px", background: "var(--color-background)", borderRadius: "10px" }}>
              Semua Pejuang yang terpetakan pada mesin ini sudah melakukan tap finger.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e4efff" }}>
                    {["Nama Pejuang", "Departemen", "Keterangan", "Catatan", ...(canSync ? ["Aksi"] : [])].map((label) => (
                      <th key={label} style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {missingAttendance.map((employee) => (
                    <tr key={employee.uid} style={{ borderBottom: "1px solid #eef4ff" }}>
                      <td style={{ padding: "12px 14px", fontSize: "14px", fontWeight: 600 }}><Link href={`/employees/${employee.uid}`} style={{ color: "var(--color-on-background)", textDecoration: "none" }}>{employee.name}</Link></td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-outline)" }}>{employee.department || "—"}</td>
                      <td style={{ padding: "12px 14px" }}>
                        {employee.status_type ? (
                          <span style={{ display: "inline-flex", padding: "4px 10px", borderRadius: "6px", background: employee.status_type === "Alfa" ? "var(--color-error-container)" : "rgba(234,179,8,0.12)", color: employee.status_type === "Alfa" ? "var(--color-error)" : "#a16207", fontSize: "12px", fontWeight: 700 }}>
                            {employee.status_type}
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-outline)", fontSize: "12px", fontStyle: "italic" }}>Belum diberi keterangan</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", maxWidth: "320px", overflow: "hidden", textOverflow: "ellipsis", color: "var(--color-outline)", fontSize: "13px" }} title={employee.status_reason || ""}>{employee.status_reason || "—"}</td>
                      {canSync && (
                        <td style={{ padding: "12px 14px" }}>
                          <button type="button" onClick={() => openAttendanceStatusModal(employee)}
                            style={{ padding: "7px 12px", border: "1px solid var(--color-primary)", borderRadius: "8px", background: "transparent", color: "var(--color-primary)", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                            {employee.status_type ? "Ubah" : "Beri Keterangan"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Tabel Riwayat ─────────────────────────────────────────────── */}
        <div className="glass-card" style={{ order: 1, borderRadius: "16px", padding: "24px" }}>
          {/* Toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Riwayat Kehadiran</h2>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {/* Filter tanggal */}
              <input type="date" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
                style={{ padding: "8px 12px", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)", background: "var(--color-surface-variant)", outline: "none", cursor: "pointer" }} />
              {/* Search */}
              <div style={{ position: "relative" }}>
                <span className="material-symbols-outlined" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "16px", color: "var(--color-outline)" }}>search</span>
                <input type="text" placeholder="Cari nama atau UID..." value={filterSearch}
                  onChange={(e) => { setFilterSearch(e.target.value); setPage(1); }}
                  style={{ padding: "8px 12px 8px 34px", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)", background: "var(--color-surface-variant)", outline: "none", width: "200px" }} />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-outline)" }}>
                Baris
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Jumlah baris riwayat per halaman"
                  style={{ padding: "8px 10px", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)", background: "var(--color-surface-variant)" }}>
                  {[5, 10, 15, 20].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              {/* Reset filter */}
              {(filterDate || filterSearch) && (
                <button onClick={() => { setFilterDate(""); setFilterSearch(""); setPage(1); }}
                  style={{ padding: "8px 12px", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", color: "var(--color-outline)", background: "var(--color-surface)", cursor: "pointer" }}>
                  Setel Ulang
                </button>
              )}
              {/* Excel download */}
              <button onClick={() => setExportModal({ ...exportModal, open: true })}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", background: "var(--color-primary-container)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)", cursor: "pointer", boxShadow: "0 2px 6px rgba(33,115,70,0.3)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>download</span>
                Unduh Laporan
              </button>
            </div>
          </div>

          {/* Table */}
          <div id="report-table-container" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e4efff" }}>
                  {[
                    { key: "date", label: "Tanggal" },
                    { key: "name", label: "Karyawan" },
                    { key: "department", label: "Departemen" },
                    { key: "check_in", label: "Jam Masuk" },
                    { key: "check_out", label: "Jam Keluar" },
                    { key: "durasi", label: "Durasi" },
                    { key: "scan_count", label: "Pindaian" },
                  ].map(h => (
                    <th key={h.key} 
                        onClick={() => {
                          if (h.key === 'durasi') return; // Cannot sort by durasi easily in SQL here
                          setPage(1);
                          setSortConfig(s => ({
                            col: h.key,
                            dir: s.col === h.key && s.dir === 'asc' ? 'desc' : 'asc'
                          }));
                        }}
                        style={{ padding: "10px 14px", textAlign: "left", fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: "var(--color-outline)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, cursor: h.key === 'durasi' ? 'default' : 'pointer', userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        {h.label}
                        {sortConfig.col === h.key && (
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
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skel-row-${i}`} style={{ borderBottom: "1px solid #eef4ff" }}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={`skel-col-${j}`} style={{ padding: "12px 14px" }}>
                          <div className="skeleton" style={{ width: j === 1 ? "80%" : "60%", height: "16px", borderRadius: "6px" }}></div>
                        </td>
                      ))}
                    </tr>
                  ))
                ) : report.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: "40px", textAlign: "center", color: "var(--color-outline)" }}>
                      <span className="material-symbols-outlined" style={{ display: "block", fontSize: "40px", opacity: 0.3, marginBottom: "8px" }}>inbox</span>
                      {filterDate || filterSearch ? "Tidak ada rekaman untuk filter tersebut." : "Belum ada rekaman kehadiran hari ini."}
                    </td>
                  </tr>
                ) : report.map((item, idx) => {
                  const isLeave  = !!item.leave_type;
                  const checkIn  = item.check_in ? new Date(item.check_in) : null;
                  const checkOut = item.check_out ? new Date(item.check_out) : null;
                  const same     = checkIn && checkOut && checkIn.getTime() === checkOut.getTime();
                  const durMs    = checkIn && checkOut ? checkOut - checkIn : 0;
                  const durHr    = Math.floor(durMs / 3600000);
                  const durMin   = Math.floor((durMs % 3600000) / 60000);
                  const attendanceDate = item.date || item.attendance_date;
                  const parsedDate = attendanceDate ? new Date(attendanceDate) : null;
                  const dateStr = parsedDate && !Number.isNaN(parsedDate.getTime())
                    ? parsedDate.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" })
                    : "—";

                  return (
                    <tr key={idx} style={{ borderBottom: "1px solid #eef4ff", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--color-background)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-outline)" }}>{dateStr}</td>
                      <td style={{ padding: "12px 14px" }}>
                        {item.name
                          ? item.employee_uid
                            ? <Link href={`/employees/${item.employee_uid}`} style={{ fontWeight: 600, color: "var(--color-on-background)", fontSize: "14px", textDecoration: "none" }}>{item.name}</Link>
                            : <span style={{ fontWeight: 600, color: "var(--color-on-background)", fontSize: "14px" }}>{item.name}</span>
                          : <span style={{ color: "var(--color-error)", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>UID: {item.device_uid}</span>
                        }
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-outline)" }}>{item.department || "-"}</td>
                      <td style={{ padding: "12px 14px" }}>
                        {isLeave ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", background: "rgba(234,179,8,0.1)", color: "#ca8a04", borderRadius: "6px", fontSize: "12px", fontWeight: 700, textTransform: "uppercase" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>event_note</span>
                            {item.leave_type}
                          </span>
                        ) : checkIn ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", background: "rgba(5,150,105,0.08)", color: "var(--color-primary)", borderRadius: "6px", fontSize: "13px", fontWeight: 600 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>login</span>
                            {checkIn.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        ) : "-"}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        {isLeave ? (
                          <span style={{ fontSize: "12px", color: "var(--color-outline)" }}>-</span>
                        ) : checkOut && same ? (
                          <span style={{ fontSize: "12px", color: "var(--color-outline)", fontStyle: "italic" }}>Belum absen keluar</span>
                        ) : checkOut ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", background: "var(--color-surface-variant)", border: "1px solid #c3c6d6", color: "#434654", borderRadius: "6px", fontSize: "13px", fontWeight: 600 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>logout</span>
                            {checkOut.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        ) : "-"}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", color: "#434654", fontFamily: "'JetBrains Mono', monospace" }}>
                        {isLeave || same ? "-" : `${durHr}j ${durMin}m`}
                      </td>
                      <td style={{ padding: "12px 14px", fontSize: "13px", color: "var(--color-outline)", textAlign: "center" }}>
                        <span style={{ background: "var(--color-surface-container-high)", color: "var(--color-primary)", borderRadius: "12px", padding: "2px 10px", fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", fontWeight: 600 }}>
                          {item.scan_count || 0}×
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          {totalItems > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", borderTop: "1px solid var(--color-surface-variant)", paddingTop: "16px" }}>
              <span style={{ fontSize: "13px", color: "var(--color-outline)", fontWeight: 500 }}>
                Menampilkan {Math.min((page - 1) * pageSize + 1, totalItems)}–{Math.min(page * pageSize, totalItems)} dari {totalItems} data
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))} 
                  disabled={page === 1}
                  style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 16px", background: page === 1 ? "var(--color-surface-variant)" : "var(--color-primary)", color: page === 1 ? "var(--color-outline)" : "var(--color-on-primary)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: page === 1 ? "not-allowed" : "pointer", transition: "all 0.2s" }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>chevron_left</span>
                  Sebelumnya
                </button>
                <button 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                  disabled={page === totalPages}
                  style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 16px", background: page === totalPages ? "var(--color-surface-variant)" : "var(--color-primary)", color: page === totalPages ? "var(--color-outline)" : "var(--color-on-primary)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: page === totalPages ? "not-allowed" : "pointer", transition: "all 0.2s" }}
                >
                  Selanjutnya
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>chevron_right</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={attendanceStatusModal.open}
        onClose={() => setAttendanceStatusModal({ open: false, employee: null, type: "Izin", reason: "", error: "" })}
        title="Keterangan Belum Tap Finger"
        size="sm"
      >
        {attendanceStatusModal.employee && (
          <form onSubmit={saveAttendanceStatus} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ padding: "12px", borderRadius: "8px", background: "var(--color-background)" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-on-background)" }}>{attendanceStatusModal.employee.name}</div>
              <div style={{ marginTop: "3px", fontSize: "12px", color: "var(--color-outline)" }}>
                {attendanceStatusModal.employee.department || "Tanpa departemen"} · {filterDate || "Hari ini"}
              </div>
            </div>
            <div>
              <label htmlFor="attendance-status-type" style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "var(--color-outline)" }}>Keterangan</label>
              <select id="attendance-status-type" required value={attendanceStatusModal.type}
                onChange={(event) => setAttendanceStatusModal((current) => ({ ...current, type: event.target.value }))}
                style={{ width: "100%", padding: "10px 12px", border: "1px solid #c3c6d6", borderRadius: "8px", color: "var(--color-on-background)", background: "var(--color-surface)" }}>
                <option value="Izin">Izin</option>
                <option value="Sakit">Sakit</option>
                <option value="Alfa">Alfa</option>
              </select>
            </div>
            <div>
              <label htmlFor="attendance-status-reason" style={{ display: "block", marginBottom: "6px", fontSize: "12px", fontWeight: 600, color: "var(--color-outline)" }}>Catatan (opsional)</label>
              <textarea id="attendance-status-reason" rows={3} maxLength={1000} value={attendanceStatusModal.reason}
                onChange={(event) => setAttendanceStatusModal((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Contoh: Surat dokter menyusul"
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #c3c6d6", borderRadius: "8px", resize: "vertical", color: "var(--color-on-background)", background: "var(--color-surface)" }} />
            </div>
            {attendanceStatusModal.error && <p role="alert" style={{ margin: 0, color: "var(--color-error)", fontSize: "13px" }}>{attendanceStatusModal.error}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" onClick={() => setAttendanceStatusModal({ open: false, employee: null, type: "Izin", reason: "", error: "" })}
                style={{ padding: "9px 16px", border: "1px solid #c3c6d6", borderRadius: "8px", background: "var(--color-surface)", color: "var(--color-on-background)", cursor: "pointer" }}>Batal</button>
              <button type="submit" disabled={isSavingAttendanceStatus}
                style={{ padding: "9px 16px", border: "none", borderRadius: "8px", background: "var(--color-primary)", color: "var(--color-surface)", fontWeight: 600, cursor: isSavingAttendanceStatus ? "wait" : "pointer", opacity: isSavingAttendanceStatus ? 0.7 : 1 }}>
                {isSavingAttendanceStatus ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Sync Result Modal */}
      <Modal isOpen={syncModal.open} onClose={() => setSyncModal({ open: false, message: "", success: null })} title={!syncModal.success ? "Sinkronisasi Gagal" : syncModal.diagnostics?.warnings?.length ? "Sinkronisasi Selesai dengan Peringatan" : "Sinkronisasi Berhasil"} size="sm">
        <div style={{ background: syncModal.success ? "rgba(5,150,105,0.06)" : "rgba(239,68,68,0.06)", borderRadius: "10px", padding: "16px", marginBottom: "20px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
          <span className="material-symbols-outlined" style={{ color: syncModal.success ? "var(--color-primary)" : "var(--color-error)", fontVariationSettings: "'FILL' 1", flexShrink: 0 }}>
            {syncModal.success ? "check_circle" : "error"}
          </span>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--color-on-background)", whiteSpace: "pre-line", lineHeight: 1.7 }}>{syncModal.message}</p>
        </div>
        {syncModal.diagnostics && (
          <div style={{ border: "1px solid var(--color-outline-variant)", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", fontSize: "13px", lineHeight: 1.8 }}>
            {[
              ["Log di mesin", syncModal.diagnostics.machine_log_count === null
                ? `tidak diketahui (terbaca ${syncModal.diagnostics.read_log_count})`
                : `${syncModal.diagnostics.machine_log_count} (terbaca ${syncModal.diagnostics.read_log_count})`],
              ["Log di database", syncModal.diagnostics.database_log_count],
              ["Scan terakhir di mesin", formatScanTime(syncModal.diagnostics.latest_machine_log)],
              ["Scan terakhir di database", formatScanTime(syncModal.diagnostics.latest_database_log)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
                <span style={{ color: "var(--color-outline)" }}>{label}</span>
                <span style={{ fontWeight: 600, color: "var(--color-on-background)", fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>{value}</span>
              </div>
            ))}
          </div>
        )}
        {syncModal.diagnostics?.warnings?.length > 0 && (
          <div role="alert" style={{ background: "rgba(234,179,8,0.12)", border: "1px solid rgba(202,138,4,0.4)", borderRadius: "10px", padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "var(--color-on-background)", lineHeight: 1.6 }}>
            {syncModal.diagnostics.warnings.map((warning) => (
              <div key={warning} style={{ display: "flex", gap: "8px" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px", color: "#ca8a04", flexShrink: 0 }}>warning</span>
                {warning}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => setSyncModal({ open: false, message: "", success: null })}
            style={{ padding: "10px 20px", background: "var(--color-primary)", color: "var(--color-surface)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            Tutup
          </button>
        </div>
      </Modal>

      {/* Export Report Modal */}
      <Modal isOpen={exportModal.open} onClose={() => setExportModal({ ...exportModal, open: false })} title="Unduh Laporan Kehadiran" size="sm">
        <form onSubmit={handleExportSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-grid">
            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Dari Tanggal</label>
              <input type="date" value={exportModal.dateFrom} onChange={e => setExportModal({ ...exportModal, dateFrom: e.target.value })}
                style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Sampai Tanggal</label>
              <input type="date" value={exportModal.dateTo} onChange={e => setExportModal({ ...exportModal, dateTo: e.target.value })}
                style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none" }} />
            </div>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Departemen (Opsional)</label>
            <input type="text" placeholder="Semua departemen" value={exportModal.department} onChange={e => setExportModal({ ...exportModal, department: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none", marginBottom: "16px" }} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "11px", fontWeight: 600, color: "var(--color-outline)", textTransform: "uppercase" }}>Format Ekspor</label>
            <select value={exportModal.format} onChange={e => setExportModal({ ...exportModal, format: e.target.value })}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #c3c6d6", borderRadius: "8px", fontSize: "14px", color: "var(--color-on-background)", background: "var(--color-background)", outline: "none" }}>
              <option value="excel">Microsoft Excel (.xlsx)</option>
              <option value="pdf">Laporan Cetak (.pdf)</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "8px" }}>
            <button type="button" onClick={() => setExportModal({ ...exportModal, open: false })} style={{
              padding: "10px 18px", border: "1px solid #c3c6d6", borderRadius: "8px", background: "var(--color-surface)", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "var(--color-on-background)",
            }}>Batal</button>
            <button type="submit" style={{
              padding: "10px 18px", background: "var(--color-primary-container)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>download</span>
              {exportModal.format === 'pdf' ? "Unduh PDF" : "Unduh XLSX"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Welcome Modal */}
      <Modal isOpen={welcomeModal} onClose={handleCloseWelcome} title="Selamat Datang" size="sm">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "10px 0" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "20px", background: "var(--color-surface-container-high)",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px"
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: "32px", color: "var(--color-primary)" }}>waving_hand</span>
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>
            Assalamualaikum Warahmatullahi Wabarakatuh
          </h2>
          <p style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 600, color: "var(--color-primary)" }}>
            {(() => {
              const h = new Date().getHours();
              if (h >= 3 && h < 11) return "Selamat Pagi!";
              if (h >= 11 && h < 15) return "Selamat Siang!";
              if (h >= 15 && h < 18) return "Selamat Sore!";
              return "Selamat Malam!";
            })()}
          </p>
          <p style={{ margin: "0 0 24px", fontSize: "14px", color: "var(--color-outline)", lineHeight: 1.6 }}>
            Selamat bekerja hari ini! Semoga pekerjaan kita senantiasa diberkahi dan berjalan dengan lancar.
          </p>
          <button onClick={handleCloseWelcome} style={{
            padding: "10px 24px", background: "var(--color-primary)", color: "var(--color-surface)",
            border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: 600, cursor: "pointer",
            width: "100%", transition: "opacity 0.2s"
          }} onMouseEnter={e => e.currentTarget.style.opacity = 0.9} onMouseLeave={e => e.currentTarget.style.opacity = 1}>
            Mulai Bekerja
          </button>
        </div>
      </Modal>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .skeleton {
          animation: shimmer 1.5s infinite linear;
          background: linear-gradient(to right, var(--color-surface-container-high) 4%, var(--color-surface-container-highest) 25%, var(--color-surface-container-high) 36%);
          background-size: 800px 100%;
        }
        .dashboard-container { padding: 20px 40px 80px; max-width: 1440px; margin: 0 auto; }
        .metrics-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px; margin-bottom: 20px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .span-8 { grid-column: span 8; }
        .span-4 { grid-column: span 4; }
        @media (max-width: 1024px) {
          .span-8 { grid-column: span 12; }
          .span-4 { grid-column: span 6; }
        }
        @media (max-width: 767px) {
          .dashboard-container { padding: 20px 16px 80px; }
          .metrics-grid { grid-template-columns: 1fr; }
          .form-grid { grid-template-columns: 1fr; }
          .span-8, .span-4 { grid-column: span 1; }
        }
      `}</style>
    </DashboardShell>
  );
}
