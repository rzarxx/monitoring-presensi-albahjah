import { getUserSession, isDepartmentManager } from '@/lib/auth';
import { subscribeRealtimeEvents } from '@/lib/events';
import { ensureRealtimeMonitorStarted } from '@/lib/realtime-monitor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const user = await getUserSession(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Akses ditolak.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pastikan background monitor ZKTeco berjalan begitu ada client yang membuka dashboard
  ensureRealtimeMonitorStarted();

  const encoder = new TextEncoder();
  let cleanup = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream sudah ditutup
        }
      };

      // Kirim sinyal awal bahwa SSE tersambung
      send({ type: 'connected', timestamp: Date.now() });

      const unsubscribe = subscribeRealtimeEvents(async (event) => {
        const currentUser = await getUserSession(request).catch(() => null);
        if (!currentUser) return;
        if (isDepartmentManager(currentUser.role)) {
          if (['attendance', 'sync', 'employees', 'leaves', 'devices'].includes(event.type)) send({ type: event.type, timestamp: event.timestamp });
          else if (event.type === 'machine_status') send({ type: event.type, device_id: event.device_id, online: event.online });
        } else send(event);
      });

      // Heartbeat setiap 15 detik agar proxy/nginx tidak memutus koneksi SSE
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      request.signal?.addEventListener('abort', () => {
        if (cleanup) cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
