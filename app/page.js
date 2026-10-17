"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import DashboardShell from "@/app/components/DashboardShell";
import Modal from "@/app/components/Modal";
import AttendanceChart from "@/app/components/AttendanceChart";
import DeviceSelect, { useSelectedDevice } from "@/app/components/DeviceSelect";

// "2026-10-17 10:25:59" -> "17/10/2026 10:25"
function formatScanTime(value) {
  if (!value) return "belum ada";
  const [date, time = ""] = value.split(" ");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time.slice(0, 5)}`;
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
  const [totalPages, setTotalPages] = useState(1);
  const [syncModal, setSyncModal] = useState({ open: false, message: "", success: null });
  const [exportModal, setExportModal] = useState({ open: false, dateFrom: "", dateTo: "", department: "", format: "excel" });
  const [welcomeModal, setWelcomeModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [machineStatus, setMachineStatus] = useState({ online: true, ip: "Memeriksa..." });
  const [chartData, setChartData] = useState([]);
  const { devices, deviceId: selectedDeviceId, setDeviceId: setSelectedDeviceId } = useSelectedDevice();
  const [canSync, setCanSync] = useState(false);

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
      params.append("device_id", selectedDeviceId);
      const res = await fetch("/api/logs?" + params.toString());
      if (!res.ok) return;
      const json = await res.json();
      if (json.data)    setLogs(json.data);
      if (json.report)  setReport(json.report);
      if (json.metrics) setMetrics(json.metrics);
      if (json.pagination) setTotalPages(json.pagination.totalPages || 1);
    } catch (e) { 
      console.error(e); 
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [filterDate, filterSearch, sortConfig, page, selectedDeviceId]);

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
      const res = await fetch(`/api/stats?device_id=${selectedDeviceId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) setChartData(json.data);
      }
    } catch (e) { console.error(e); }
  }, [selectedDeviceId]);

  // Auto-sync & Real-time setup
  const autoSyncRef = useRef(false);
  const manualSyncRef = useRef(false);

  useEffect(() => {
    if (!selectedDeviceId) return;
    // Initial fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
    fetchMachineStatus();
    fetchChartData();
    
    // Poll status jaringan tiap 15 detik
    const statusIv = setInterval(fetchMachineStatus, 15000);
    let syncIv;
    if (canSync) {
      // Auto sync hanya untuk peran yang berwenang.
      handleSync(false, true);
      syncIv = setInterval(() => handleSync(false, true), 60000);
    }

    return () => {
      clearInterval(statusIv);
      if (syncIv) clearInterval(syncIv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchLogs, fetchMachineStatus, fetchChartData, selectedDeviceId, canSync]);

  // Manual & Silent sync. Auto-sync dilewati bila ada sinkronisasi lain, tetapi klik
  // manual selalu dikirim: server menggabungkannya dengan sinkronisasi yang sedang berjalan.
  async function handleSync(full = false, silent = false) {
    if (!selectedDeviceId) {
      if (!silent) setSyncModal({ open: true, success: false, message: "Pilih mesin terlebih dahulu." });
      return;
    }
    if (silent) {
      if (autoSyncRef.current || manualSyncRef.current || document.visibilityState !== "visible") return;
      autoSyncRef.current = true;
    } else {
      if (manualSyncRef.current) return;
      manualSyncRef.current = true;
      setIsSyncing(true);
    }
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full, device_id: Number(selectedDeviceId) }),
      });
      // Gateway/proxy yang timeout mengembalikan HTML, bukan JSON.
      const json = await res.json().catch(() => ({}));

      if (!silent) {
        setSyncModal({
          open: true,
          success: res.ok,
          message: res.ok
            ? `${json.message || "Sinkronisasi selesai!"}\n• ${json.synced ?? 0} log baru\n• ${json.users_synced ?? 0} user mesin disinkronkan`
            : `Gagal: ${json.error || `server merespons ${res.status}. Coba lagi beberapa saat.`}`,
          diagnostics: res.ok ? json.diagnostics || null : null,
        });
      }

      if (res.ok && (json.synced > 0 || !silent)) {
        fetchLogs(true);
      }
    } catch (e) {
      if (!silent) setSyncModal({ open: true, success: false, message: "Koneksi ke server gagal." });
    } finally {
      if (silent) {
        autoSyncRef.current = false;
      } else {
        manualSyncRef.current = false;
        setIsSyncing(false);
      }
    }
  }

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
      <div className="dashboard-container">

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
            {canSync && <span style={{ fontSize: "12px", color: "var(--color-primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px", background: "var(--color-surface-container-high)", padding: "6px 12px", borderRadius: "20px" }}>
              <span className="status-pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-primary)" }} />
              Realtime Auto-Sync Aktif
            </span>}
            {canSync && <>
            <button onClick={() => handleSync(true)} disabled={isSyncing} aria-busy={isSyncing}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", background: "var(--color-surface-variant)", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-primary)", cursor: isSyncing ? "wait" : "pointer", opacity: isSyncing ? 0.72 : 1, transition: "opacity 0.2s" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px", animation: isSyncing ? "spin 1s linear infinite" : "none" }}>{isSyncing ? "progress_activity" : "history"}</span>
              {isSyncing ? "Sedang menyinkronkan..." : "Sinkronkan Semua Data"}
            </button>
            <button onClick={() => handleSync(false)} disabled={isSyncing} aria-busy={isSyncing}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 16px", background: "var(--color-primary)", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, color: "var(--color-surface)", cursor: isSyncing ? "wait" : "pointer", opacity: isSyncing ? 0.78 : 1, transition: "opacity 0.2s", boxShadow: "0 2px 8px rgba(0,61,155,0.3)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px", animation: isSyncing ? "spin 1s linear infinite" : "none" }}>{isSyncing ? "progress_activity" : "sync"}</span>
              {isSyncing ? "Sedang menyinkronkan..." : "Sinkronkan Data Terbaru"}
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
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-outline)" }}>Ringkasan kehadiran, cuti, izin, dan sakit Pejuang.</p>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: "24px", color: "var(--color-outline-variant)" }}>bar_chart</span>
          </div>
          <AttendanceChart data={chartData} />
        </div>

        {/* ── Tabel Riwayat ─────────────────────────────────────────────── */}
        <div className="glass-card" style={{ borderRadius: "16px", padding: "24px" }}>
          {/* Toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Riwayat Kehadiran</h2>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {/* Filter tanggal */}
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                style={{ padding: "8px 12px", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)", background: "var(--color-surface-variant)", outline: "none", cursor: "pointer" }} />
              {/* Search */}
              <div style={{ position: "relative" }}>
                <span className="material-symbols-outlined" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", fontSize: "16px", color: "var(--color-outline)" }}>search</span>
                <input type="text" placeholder="Cari nama atau UID..." value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  style={{ padding: "8px 12px 8px 34px", border: "1px solid #c3c6d6", borderRadius: "8px", fontSize: "13px", color: "var(--color-on-background)", background: "var(--color-surface-variant)", outline: "none", width: "200px" }} />
              </div>
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
                          ? <span style={{ fontWeight: 600, color: "var(--color-on-background)", fontSize: "14px" }}>{item.name}</span>
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
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", borderTop: "1px solid var(--color-surface-variant)", paddingTop: "16px" }}>
              <span style={{ fontSize: "13px", color: "var(--color-outline)", fontWeight: 500 }}>
                Menampilkan Halaman {page} dari {totalPages}
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
