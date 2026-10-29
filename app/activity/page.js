"use client";

import { useCallback, useEffect, useState } from 'react';
import DashboardShell from '@/app/components/DashboardShell';
import { useRealtimeStream } from '@/app/components/useRealtimeStream';

const levelStyle = {
  info: { label: 'Info', color: '#0369a1', background: '#e0f2fe', icon: 'info' },
  warning: { label: 'Peringatan', color: '#a16207', background: '#fef3c7', icon: 'warning' },
  error: { label: 'Error', color: '#b91c1c', background: '#fee2e2', icon: 'error' },
};

function formatTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

export default function ActivityPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (level) params.set('level', level);
      if (source) params.set('source', source);
      const response = await fetch(`/api/operational-logs?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Log operasional gagal dimuat.');
      setLogs(data.data || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Log operasional gagal dimuat.');
    } finally {
      setLoading(false);
    }
  }, [level, source]);

  useEffect(() => { load(); }, [load]);

  useRealtimeStream((event) => {
    if (event.type === 'operational_log') load();
  });

  return (
    <DashboardShell>
      <div className="activity-page">
        <header>
          <div>
            <p>SUPER ADMIN</p>
            <h1>Log Operasional</h1>
            <span>Riwayat sinkronisasi terjadwal, aktivitas manual, dan error mesin.</span>
          </div>
          <button className="refresh" onClick={load} disabled={loading}>
            <span className="material-symbols-outlined">refresh</span>{loading ? 'Memuat...' : 'Muat ulang'}
          </button>
        </header>

        <section className="filters glass-card" aria-label="Filter log">
          <label>Level<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">Semua level</option><option value="info">Info</option><option value="warning">Peringatan</option><option value="error">Error</option></select></label>
          <label>Sumber<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Semua sumber</option><option value="scheduler">Terjadwal</option><option value="manual">Manual</option><option value="system">Sistem</option></select></label>
        </section>

        {error ? <div className="notice"><span className="material-symbols-outlined">error</span>{error}</div> : null}
        <section className="glass-card logs" aria-busy={loading}>
          {loading ? <div className="empty">Memuat riwayat operasional...</div> : logs.length === 0 ? <div className="empty">Belum ada aktivitas yang tercatat.</div> : logs.map((log) => {
            const style = levelStyle[log.level] || levelStyle.info;
            return <article key={log.id}>
              <span className="material-symbols-outlined badge" style={{ color: style.color, background: style.background }}>{style.icon}</span>
              <div className="message"><strong>{log.message}</strong><small>{formatTime(log.created_at)} · {log.source === 'scheduler' ? 'Terjadwal' : log.source === 'manual' ? 'Manual' : 'Sistem'}{log.device_name ? ` · ${log.device_name}` : ''}</small></div>
              <span className="level" style={{ color: style.color, background: style.background }}>{style.label}</span>
            </article>;
          })}
        </section>
      </div>
      <style>{`.activity-page{max-width:1100px;margin:0 auto;padding:28px 40px 80px}.activity-page header{display:flex;justify-content:space-between;align-items:end;gap:16px;margin-bottom:20px}.activity-page header p{margin:0 0 5px;color:var(--color-primary);font-weight:800;font-size:11px;letter-spacing:.1em}.activity-page h1{margin:0;font-size:32px;letter-spacing:-.03em}.activity-page header span{display:block;margin-top:5px;color:var(--color-outline);font-size:14px}.refresh{display:flex;align-items:center;gap:7px;border:0;border-radius:9px;background:var(--color-primary);color:var(--color-on-primary);padding:10px 14px;font-weight:700;cursor:pointer}.refresh:disabled{opacity:.65;cursor:wait}.filters{display:flex;gap:14px;padding:16px 20px;margin-bottom:16px}.filters label{display:grid;gap:5px;color:var(--color-outline);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.filters select{min-width:170px;padding:8px;border:1px solid var(--color-outline-variant);border-radius:7px;background:var(--color-surface);color:var(--color-on-surface);font:inherit;text-transform:none;letter-spacing:normal}.notice{display:flex;align-items:center;gap:8px;padding:13px 16px;border-radius:9px;background:var(--color-error-container);color:var(--color-on-error-container);margin-bottom:16px;font-size:14px}.logs{overflow:hidden}.logs article{display:flex;align-items:center;gap:13px;padding:15px 20px;border-bottom:1px solid var(--color-outline-variant)}.logs article:last-child{border-bottom:0}.badge{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;font-size:18px;flex:none}.message{display:grid;gap:4px;min-width:0;flex:1}.message strong{font-size:14px;line-height:1.4}.message small{font-size:12px;color:var(--color-outline)}.level{font-size:11px;font-weight:800;padding:5px 8px;border-radius:999px;white-space:nowrap}.empty{padding:45px 20px;text-align:center;color:var(--color-outline)}@media(max-width:767px){.activity-page{padding:22px 16px 88px}.activity-page header{align-items:start;flex-direction:column}.filters{display:grid}.filters select{width:100%}.logs article{align-items:start;padding:14px}.level{display:none}.message strong{font-size:13px}}`}</style>
    </DashboardShell>
  );
}
