import { NextResponse } from 'next/server';
import net from 'net';
import { getUserSession } from '@/lib/auth';

export async function GET(request) {
  try {
    const user = await getUserSession(request);
    if (!user) return NextResponse.json({ error: 'Akses ditolak.' }, { status: 401 });

    const ip = process.env.ZK_IP || '192.168.1.100';
    const port = parseInt(process.env.ZK_PORT || '4370', 10);

    // Return a promise that resolves true if connected, false if error/timeout
    const isOnline = await new Promise((resolve) => {
      const socket = new net.Socket();
      
      // Set timeout to 2 seconds for quick response
      socket.setTimeout(2000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, ip);
    });

    return NextResponse.json({
      online: isOnline,
      // IP & Port dihilangkan demi keamanan internal (tidak diekspos ke frontend)
    });
  } catch (error) {
    return NextResponse.json({ online: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
