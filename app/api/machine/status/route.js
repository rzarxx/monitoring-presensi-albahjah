import { NextResponse } from 'next/server';
import net from 'net';
import { getDeviceOnlineStatus, isDeviceBusy, setDeviceOnlineStatus } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';
import { ensureRealtimeMonitorStarted } from '@/lib/realtime-monitor';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const device = await requireDevice(new URL(request.url).searchParams);

    ensureRealtimeMonitorStarted();

    // Jika sedang ada pekerjaan sync berjalan, mesin pasti sedang online
    if (isDeviceBusy(device)) {
      return NextResponse.json({ online: true, device: { id: device.id, code: device.code, name: device.name } });
    }

    // Gunakan status dari real-time listener tanpa membuka koneksi TCP baru yang bisa memutus sesi mesin
    const cached = getDeviceOnlineStatus(device);
    if (cached && Date.now() - cached.updatedAt < 45000) {
      return NextResponse.json({ online: cached.online, device: { id: device.id, code: device.code, name: device.name } });
    }

    if (!device.host || device.host === '0.0.0.0' || !device.port) {
      return NextResponse.json({ online: false, device: { id: device.id, code: device.code, name: device.name } });
    }

    const online = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.connect(device.port, device.host);
    });
    setDeviceOnlineStatus(device, online);
    return NextResponse.json({ online, device: { id: device.id, code: device.code, name: device.name } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memeriksa mesin.' }, { status: error.status || 500 });
  }
}
