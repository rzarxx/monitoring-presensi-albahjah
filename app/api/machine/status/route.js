import { NextResponse } from 'next/server';
import net from 'net';
import { getUserSession } from '@/lib/auth';
import { requireDevice } from '@/lib/devices';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });
    const device = await requireDevice(new URL(request.url).searchParams);
    const online = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(2000);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.connect(device.port, device.host);
    });
    return NextResponse.json({ online, device: { id: device.id, code: device.code, name: device.name } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Gagal memeriksa mesin.' }, { status: error.status || 500 });
  }
}
