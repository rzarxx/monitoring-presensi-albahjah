"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/app/components/DashboardShell";
import AttendanceChart from "@/app/components/AttendanceChart";
import DeviceSelect, { useSelectedDevice } from "@/app/components/DeviceSelect";
import { useParams } from "next/navigation";

export default function EmployeeProfile() {
  const { uid } = useParams();
  const { devices, deviceId, setDeviceId, loaded: devicesLoaded } = useSelectedDevice();
  const [employee, setEmployee] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

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

      // 2. Get 7-Day Stats for this user
      const statsRes = deviceId
        ? await fetch(`/api/stats?employee_uid=${encodeURIComponent(uid)}&device_id=${encodeURIComponent(deviceId)}`)
        : null;
      if (statsRes?.ok) {
        const statsJson = await statsRes.json();
        setChartData(statsJson.data || []);
      }

      // 3. Get Recent Logs for this user
      const logsRes = deviceId
        ? await fetch(`/api/logs?employee_uid=${encodeURIComponent(uid)}&limit=10&device_id=${encodeURIComponent(deviceId)}`)
        : null;
      if (logsRes?.ok) {
        const logsJson = await logsRes.json();
        setLogs(logsJson.data || []);
      }

    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [uid, deviceId, devicesLoaded]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

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
            </div>

            {/* Statistik */}
            <div className="glass-card" style={{ borderRadius: "16px", padding: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Statistik Harian (7 Hari Terakhir)</h2>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: "24px", color: "var(--color-outline-variant)" }}>bar_chart</span>
              </div>
              <AttendanceChart data={chartData} />
            </div>

            {/* Riwayat Terakhir */}
            <div className="glass-card" style={{ borderRadius: "16px", padding: "24px", gridColumn: "1 / -1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-on-background)" }}>Riwayat Terakhir</h2>
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
