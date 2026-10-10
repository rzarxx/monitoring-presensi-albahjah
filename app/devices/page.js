"use client";

import { useEffect, useState } from 'react';
import DashboardShell from '@/app/components/DashboardShell';
import Modal from '@/app/components/Modal';

const emptyDevice = { code: '', name: '', model: 'X105', segment_id: '', host: '', port: '4370' };

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [segments, setSegments] = useState([]);
  const [deviceForm, setDeviceForm] = useState(emptyDevice);
  const [segmentForm, setSegmentForm] = useState({ code: '', name: '' });
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [deviceResponse, segmentResponse] = await Promise.all([fetch('/api/devices'), fetch('/api/segments')]);
    const [deviceJson, segmentJson] = await Promise.all([deviceResponse.json(), segmentResponse.json()]);
    setDevices(deviceJson.data || []);
    setSegments(segmentJson.data || []);
  };

  useEffect(() => {
    // Pengambilan konfigurasi bersifat asynchronous; state hanya berubah setelah respons API diterima.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setMessage({ type: 'error', text: 'Gagal memuat konfigurasi mesin.' }));
  }, []);

  const createSegment = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(segmentForm) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setSegmentOpen(false); setSegmentForm({ code: '', name: '' }); setMessage({ type: 'success', text: json.message }); await load();
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Gagal menambah segment.' }); }
    finally { setSaving(false); }
  };

  const createDevice = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(deviceForm) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error);
      setDeviceOpen(false); setDeviceForm(emptyDevice); setMessage({ type: 'success', text: json.message }); await load();
    } catch (error) { setMessage({ type: 'error', text: error.message || 'Gagal menambah mesin.' }); }
    finally { setSaving(false); }
  };

  const testConnection = async (device) => {
    setMessage({ type: 'info', text: `Menguji ${device.code}...` });
    const response = await fetch(`/api/devices/${device.id}/test`, { method: 'POST' });
    const json = await response.json();
    setMessage({ type: response.ok && json.online ? 'success' : 'error', text: `${device.code}: ${json.message || json.error}` });
  };

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid var(--color-outline-variant)', borderRadius: '8px', background: 'var(--color-surface)', color: 'var(--color-on-background)' };

  return (
    <DashboardShell>
      <div className="dashboard-container" style={{ maxWidth: '1100px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <div><h1 style={{ margin: 0, fontSize: '30px' }}>Mesin & Segment</h1><p style={{ color: 'var(--color-outline)' }}>Setiap data presensi disimpan dan ditampilkan per mesin.</p></div>
          <div style={{ display: 'flex', gap: '8px' }}><button onClick={() => setSegmentOpen(true)} style={{ padding: '10px 14px', border: '1px solid var(--color-outline-variant)', borderRadius: '8px', background: 'var(--color-surface)', cursor: 'pointer' }}>Tambah Segment</button><button onClick={() => setDeviceOpen(true)} style={{ padding: '10px 14px', border: 'none', borderRadius: '8px', background: 'var(--color-primary)', color: 'white', cursor: 'pointer' }}>Tambah Mesin</button></div>
        </div>
        {message && <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: '8px', background: message.type === 'success' ? 'var(--color-surface-container-high)' : 'var(--color-error-container)', color: message.type === 'success' ? 'var(--color-primary)' : 'var(--color-on-error-container)' }}>{message.text}</div>}
        <div className="glass-card" style={{ borderRadius: '14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Identitas', 'Model', 'Segment', 'Koneksi', 'Aksi'].map((label) => <th key={label} style={{ textAlign: 'left', padding: '14px', color: 'var(--color-outline)', fontSize: '12px' }}>{label}</th>)}</tr></thead><tbody>
            {devices.length === 0 ? <tr><td colSpan="5" style={{ padding: '32px', textAlign: 'center', color: 'var(--color-outline)' }}>Belum ada mesin. Tambahkan mesin pertama setelah menjalankan migrasi.</td></tr> : devices.map((device) => <tr key={device.id} style={{ borderTop: '1px solid var(--color-outline-variant)' }}><td style={{ padding: '14px' }}><strong>{device.code}</strong><br /><span style={{ fontSize: '12px', color: 'var(--color-outline)' }}>{device.name}</span></td><td style={{ padding: '14px' }}>{device.model}</td><td style={{ padding: '14px' }}>{device.segment_name || '-'}</td><td style={{ padding: '14px', fontFamily: 'monospace', fontSize: '12px' }}>{device.host ? `${device.host}:${device.port}` : 'Tersimpan aman'}</td><td style={{ padding: '14px' }}><button onClick={() => testConnection(device)} style={{ border: '1px solid var(--color-outline-variant)', borderRadius: '7px', padding: '7px 10px', background: 'white', cursor: 'pointer' }}>Uji Koneksi</button></td></tr>)}
          </tbody></table>
        </div>
      </div>
      <Modal isOpen={segmentOpen} onClose={() => setSegmentOpen(false)} title="Tambah Segment" size="sm"><form onSubmit={createSegment} style={{ display: 'grid', gap: '12px' }}><input required placeholder="Kode, contoh: PUTRA" value={segmentForm.code} onChange={(event) => setSegmentForm({ ...segmentForm, code: event.target.value })} style={inputStyle} /><input required placeholder="Nama segment" value={segmentForm.name} onChange={(event) => setSegmentForm({ ...segmentForm, name: event.target.value })} style={inputStyle} /><button disabled={saving} style={{ padding: '10px', border: 'none', borderRadius: '8px', background: 'var(--color-primary)', color: 'white' }}>Simpan Segment</button></form></Modal>
      <Modal isOpen={deviceOpen} onClose={() => setDeviceOpen(false)} title="Tambah Mesin Presensi" size="sm"><form onSubmit={createDevice} style={{ display: 'grid', gap: '12px' }}><input required placeholder="Kode unik, contoh: PUTRA-01" value={deviceForm.code} onChange={(event) => setDeviceForm({ ...deviceForm, code: event.target.value })} style={inputStyle} /><input required placeholder="Nama mesin" value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} style={inputStyle} /><select value={deviceForm.model} onChange={(event) => setDeviceForm({ ...deviceForm, model: event.target.value })} style={inputStyle}><option value="X105">Solution X105</option><option value="X103">Solution X103</option><option value="OTHER">Lainnya</option></select><select value={deviceForm.segment_id} onChange={(event) => setDeviceForm({ ...deviceForm, segment_id: event.target.value })} style={inputStyle}><option value="">Tanpa segment</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.code} — {segment.name}</option>)}</select><input required placeholder="IP atau host mesin" value={deviceForm.host} onChange={(event) => setDeviceForm({ ...deviceForm, host: event.target.value })} style={inputStyle} /><input required type="number" min="1" max="65535" placeholder="Port" value={deviceForm.port} onChange={(event) => setDeviceForm({ ...deviceForm, port: event.target.value })} style={inputStyle} /><p style={{ margin: 0, fontSize: '12px', color: 'var(--color-outline)' }}>Koneksi memakai TCP/ZKEM. Uji koneksi setelah disimpan sebelum sinkronisasi data.</p><button disabled={saving} style={{ padding: '10px', border: 'none', borderRadius: '8px', background: 'var(--color-primary)', color: 'white' }}>Simpan Mesin</button></form></Modal>
    </DashboardShell>
  );
}
