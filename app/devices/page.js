"use client";

import { useEffect, useState } from 'react';
import DashboardShell from '@/app/components/DashboardShell';
import Modal from '@/app/components/Modal';

const emptyDevice = { name: '', model: 'X105', segment_id: '', host: '', port: '4370' };
const inputStyle = { width: '100%', minHeight: '44px', padding: '10px 12px', border: '1px solid var(--color-outline-variant)', borderRadius: '8px', background: 'var(--color-surface)', color: 'var(--color-on-background)' };
const fieldLabelStyle = { display: 'block', marginBottom: '6px', color: 'var(--color-outline)', fontSize: '12px', fontWeight: 700 };

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [segments, setSegments] = useState([]);
  const [deviceForm, setDeviceForm] = useState(emptyDevice);
  const [segmentForm, setSegmentForm] = useState({ code: '', name: '' });
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState(null);

  const load = async () => {
    const [deviceResponse, segmentResponse] = await Promise.all([fetch('/api/devices'), fetch('/api/segments')]);
    const [deviceJson, segmentJson] = await Promise.all([deviceResponse.json(), segmentResponse.json()]);
    setDevices(deviceJson.data || []);
    setSegments(segmentJson.data || []);
  };

  useEffect(() => {
    // Pengambilan konfigurasi bersifat asynchronous; state berubah setelah respons API diterima.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setMessage({ type: 'error', text: 'Gagal memuat konfigurasi mesin.' }));
  }, []);

  const createSegment = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch('/api/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(segmentForm) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setSegmentOpen(false); setSegmentForm({ code: '', name: '' }); setMessage({ type: 'success', text: json.message }); await load();
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Gagal menambah segmen.' }); } finally { setSaving(false); }
  };

  const createDevice = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deviceForm) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setDeviceOpen(false); setDeviceForm(emptyDevice); setMessage({ type: 'success', text: json.message }); await load();
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Gagal menambah mesin.' }); } finally { setSaving(false); }
  };

  const testConnection = async (device) => {
    setTestingDeviceId(device.id); setMessage({ type: 'info', text: `Menguji koneksi ${device.name}...` });
    try {
      const response = await fetch(`/api/devices/${device.id}/test`, { method: 'POST' });
      const json = await response.json();
      setMessage({ type: response.ok && json.online ? 'success' : 'error', text: `${device.name}: ${json.message || json.error}` });
    } catch { setMessage({ type: 'error', text: `${device.name}: koneksi ke server gagal diuji.` }); } finally { setTestingDeviceId(null); }
  };

  const TestButton = ({ device }) => {
    const testing = testingDeviceId === device.id;
    return <button className="device-test-button" onClick={() => testConnection(device)} disabled={testing}><span className="material-symbols-outlined" aria-hidden="true">{testing ? 'progress_activity' : 'network_check'}</span>{testing ? 'Menguji...' : 'Uji koneksi'}</button>;
  };

  return (
    <DashboardShell>
      <div className="dashboard-container devices-page">
        <header className="devices-header">
          <div><p className="devices-eyebrow">KONFIGURASI PRESENSI</p><h1>Mesin &amp; Segmen</h1><p className="devices-description">Kelola mesin presensi dan kelompok penempatannya dari satu halaman.</p></div>
          <div className="devices-actions"><button className="secondary-action" onClick={() => setSegmentOpen(true)}><span className="material-symbols-outlined" aria-hidden="true">account_tree</span>Tambah segmen</button><button className="primary-action" onClick={() => setDeviceOpen(true)}><span className="material-symbols-outlined" aria-hidden="true">add</span>Tambah mesin</button></div>
        </header>

        {message && <div className={`devices-notice ${message.type}`} role="status" aria-live="polite"><span className="material-symbols-outlined" aria-hidden="true">{message.type === 'success' ? 'check_circle' : message.type === 'error' ? 'error' : 'info'}</span><span>{message.text}</span></div>}

        <section className="glass-card devices-list" aria-labelledby="devices-list-title">
          <div className="devices-list-header"><div><h2 id="devices-list-title">Daftar mesin</h2><p>{devices.length === 0 ? 'Belum ada mesin yang terdaftar.' : `${devices.length} mesin terdaftar`}</p></div></div>
          {devices.length === 0 ? (
            <div className="devices-empty"><span className="material-symbols-outlined" aria-hidden="true">memory</span><h3>Belum ada mesin</h3><p>Tambahkan mesin pertama setelah menjalankan migrasi perangkat.</p><button className="primary-action" onClick={() => setDeviceOpen(true)}>Tambah mesin</button></div>
          ) : <>
            <div className="devices-table-wrap"><table><thead><tr>{['Lokasi fingerprint', 'Model', 'Segmen', 'Koneksi', 'Aksi'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{devices.map((device) => <tr key={device.id}><td><strong>{device.name}</strong></td><td>{device.model}</td><td>{device.segment_name || 'Tanpa segmen'}</td><td><code>{device.host ? `${device.host}:${device.port}` : 'Tersimpan aman'}</code></td><td><TestButton device={device} /></td></tr>)}</tbody></table></div>
            <div className="devices-cards">{devices.map((device) => <article className="device-card" key={device.id}><div className="device-card-top"><h3>{device.name}</h3><span className="device-model">{device.model}</span></div><dl><div><dt>Segmen</dt><dd>{device.segment_name || 'Tanpa segmen'}</dd></div><div><dt>Koneksi</dt><dd><code>{device.host ? `${device.host}:${device.port}` : 'Tersimpan aman'}</code></dd></div></dl><TestButton device={device} /></article>)}</div>
          </>}
        </section>
      </div>

      <Modal isOpen={segmentOpen} onClose={() => setSegmentOpen(false)} title="Tambah Segmen" size="sm"><form onSubmit={createSegment} className="device-form"><label><span style={fieldLabelStyle}>Kode segmen</span><input required placeholder="Contoh: PUTRA" value={segmentForm.code} onChange={(event) => setSegmentForm({ ...segmentForm, code: event.target.value })} style={inputStyle} /></label><label><span style={fieldLabelStyle}>Nama segmen</span><input required placeholder="Contoh: Asrama Putra" value={segmentForm.name} onChange={(event) => setSegmentForm({ ...segmentForm, name: event.target.value })} style={inputStyle} /></label><button className="form-submit" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan segmen'}</button></form></Modal>
      <Modal isOpen={deviceOpen} onClose={() => setDeviceOpen(false)} title="Tambah Mesin Presensi" size="sm"><form onSubmit={createDevice} className="device-form"><label><span style={fieldLabelStyle}>Lokasi fingerprint</span><input required placeholder="Contoh: Lobby Asrama Putra" value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} style={inputStyle} /></label><div className="device-form-row"><label><span style={fieldLabelStyle}>Model</span><select value={deviceForm.model} onChange={(event) => setDeviceForm({ ...deviceForm, model: event.target.value })} style={inputStyle}><option value="X105">Solution X105</option><option value="X103">Solution X103</option><option value="OTHER">Lainnya</option></select></label><label><span style={fieldLabelStyle}>Segmen</span><select value={deviceForm.segment_id} onChange={(event) => setDeviceForm({ ...deviceForm, segment_id: event.target.value })} style={inputStyle}><option value="">Tanpa segmen</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.code} — {segment.name}</option>)}</select></label></div><div className="device-form-row"><label><span style={fieldLabelStyle}>IP atau host</span><input required placeholder="Contoh: 192.168.1.201" value={deviceForm.host} onChange={(event) => setDeviceForm({ ...deviceForm, host: event.target.value })} style={inputStyle} /></label><label><span style={fieldLabelStyle}>Port</span><input required type="number" min="1" max="65535" value={deviceForm.port} onChange={(event) => setDeviceForm({ ...deviceForm, port: event.target.value })} style={inputStyle} /></label></div><p className="device-form-help">Koneksi memakai TCP/ZKEM. Uji koneksi setelah disimpan sebelum sinkronisasi data.</p><button className="form-submit" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan mesin'}</button></form></Modal>

      <style>{`
        .dashboard-container.devices-page { max-width: 1100px; margin: 0 auto; padding: 32px 40px 80px; }.devices-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }.devices-eyebrow { margin: 0 0 6px; color: var(--color-primary); font-family: var(--font-jetbrains-mono, monospace); font-size: 11px; font-weight: 700; letter-spacing: .08em; }.devices-header h1 { margin: 0; color: var(--color-on-background); font-size: clamp(28px, 4vw, 36px); letter-spacing: -.025em; }.devices-description { max-width: 610px; margin: 8px 0 0; color: var(--color-outline); font-size: 14px; line-height: 1.55; }.devices-actions { display: flex; flex-wrap: wrap; gap: 10px; }
        .primary-action, .secondary-action, .device-test-button, .form-submit { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 9px; padding: 10px 14px; font-size: 13px; font-weight: 700; cursor: pointer; transition: transform .15s, box-shadow .15s, background .15s; }.primary-action, .form-submit { border: 1px solid var(--color-primary); background: var(--color-primary); color: var(--color-on-primary); box-shadow: 0 3px 10px rgba(5, 150, 105, .2); }.secondary-action, .device-test-button { border: 1px solid var(--color-outline-variant); background: var(--color-surface); color: var(--color-on-surface); }.primary-action:hover, .secondary-action:hover, .device-test-button:hover, .form-submit:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15, 23, 42, .12); }.primary-action:focus-visible, .secondary-action:focus-visible, .device-test-button:focus-visible, .form-submit:focus-visible { outline: 3px solid rgba(5, 150, 105, .3); outline-offset: 2px; }.device-test-button:disabled, .form-submit:disabled { cursor: wait; opacity: .65; transform: none; }.device-test-button .material-symbols-outlined { font-size: 17px; }
        .devices-notice { display: flex; align-items: flex-start; gap: 9px; margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; font-size: 14px; line-height: 1.45; }.devices-notice.success { background: #ecfdf5; color: #047857; }.devices-notice.error { background: var(--color-error-container); color: var(--color-on-error-container); }.devices-notice.info { background: #eff6ff; color: #1d4ed8; }.devices-list { overflow: hidden; border-radius: 14px; }.devices-list-header { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--color-outline-variant); }.devices-list-header h2 { margin: 0; font-size: 16px; color: var(--color-on-background); }.devices-list-header p { margin: 4px 0 0; color: var(--color-outline); font-size: 13px; }
        .devices-table-wrap { overflow-x: auto; }.devices-table-wrap table { width: 100%; border-collapse: collapse; min-width: 700px; }.devices-table-wrap th { padding: 12px 20px; background: var(--color-surface-container); color: var(--color-outline); font-family: var(--font-jetbrains-mono, monospace); font-size: 11px; letter-spacing: .06em; text-align: left; text-transform: uppercase; }.devices-table-wrap td { padding: 15px 20px; border-top: 1px solid var(--color-outline-variant); color: var(--color-on-surface); font-size: 14px; }.devices-table-wrap td:first-child strong { display: block; }.devices-table-wrap td:first-child span { display: block; margin-top: 3px; color: var(--color-outline); font-size: 12px; }.devices-table-wrap code, .device-card code { color: var(--color-on-surface-variant); font-family: var(--font-jetbrains-mono, monospace); font-size: 12px; word-break: break-all; }
        .devices-cards { display: none; }.device-card { padding: 16px; border-top: 1px solid var(--color-outline-variant); }.device-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.device-card h3 { margin: 0; color: var(--color-on-background); font-size: 15px; }.device-model { display: inline-block; border-radius: 6px; padding: 3px 8px; background: var(--color-surface-variant); color: var(--color-on-surface-variant); font-family: var(--font-jetbrains-mono, monospace); font-size: 11px; font-weight: 700; white-space: nowrap; }.device-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }.device-card dl div { min-width: 0; }.device-card dt { margin-bottom: 4px; color: var(--color-outline); font-size: 11px; font-weight: 700; text-transform: uppercase; }.device-card dd { margin: 0; color: var(--color-on-surface); font-size: 13px; }.device-card .device-test-button { width: 100%; }.devices-empty { display: grid; justify-items: center; padding: 48px 24px; text-align: center; }.devices-empty > .material-symbols-outlined { color: var(--color-primary); font-size: 42px; opacity: .75; }.devices-empty h3 { margin: 12px 0 4px; font-size: 17px; }.devices-empty p { max-width: 380px; margin: 0 0 20px; color: var(--color-outline); font-size: 14px; line-height: 1.5; }
        .device-form { display: grid; gap: 14px; }.device-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.device-form-help { margin: -2px 0 2px; color: var(--color-outline); font-size: 12px; line-height: 1.5; }.form-submit { width: 100%; }
        @media (max-width: 767px) { .dashboard-container.devices-page { padding: 22px 16px 88px; }.devices-header { align-items: stretch; flex-direction: column; gap: 18px; }.devices-actions { display: grid; grid-template-columns: 1fr 1fr; }.devices-actions button { width: 100%; padding-left: 8px; padding-right: 8px; }.devices-list-header { padding: 16px; }.devices-table-wrap { display: none; }.devices-cards { display: block; }.device-form-row { grid-template-columns: 1fr; }.devices-description { font-size: 13px; } } @media (max-width: 370px) { .devices-actions, .device-card dl { grid-template-columns: 1fr; }.device-card dl { gap: 10px; } }
      `}</style>
    </DashboardShell>
  );
}
