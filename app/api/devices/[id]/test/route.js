import { NextResponse } from 'next/server';
import net from 'net';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';

export async function POST(request, context) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat menguji koneksi.' }, { status: 403 });
  const { id } = await context.params;
  const device = await findDevice(parseDeviceId(id));
  if (!device) return NextResponse.json({ error: 'Mesin tidak ditemukan.' }, { status: 404 });
  const online = await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(3000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.connect(device.port, device.host);
  });
  return NextResponse.json({ online, message: online ? 'Koneksi TCP berhasil.' : 'Mesin tidak dapat dijangkau.' });
}
