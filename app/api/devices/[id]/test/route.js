import { NextResponse } from 'next/server';
import net from 'net';
import { getDeviceOnlineStatus, isDeviceBusy, setDeviceOnlineStatus } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';

export async function POST(request, context) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat menguji koneksi.' }, { status: 403 });
  const { id } = await context.params;
  const device = await findDevice(parseDeviceId(id));
  if (!device) return NextResponse.json({ error: 'Mesin tidak ditemukan.' }, { status: 404 });

  const cached = getDeviceOnlineStatus(device);
  const online = isDeviceBusy(device)
    || (cached && cached.online && Date.now() - cached.updatedAt < 30000)
    || await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.connect(device.port, device.host);
    });
  setDeviceOnlineStatus(device, online);
  return NextResponse.json({ online, message: online ? 'Koneksi TCP berhasil.' : 'Mesin tidak dapat dijangkau.' });
}
