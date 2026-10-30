import { NextResponse } from 'next/server';
import { describeZkError, isDeviceBusy, probeZkDevice, runDeviceJob } from '@/lib/zkteco';
import { getUserSession } from '@/lib/auth';
import { findDevice, parseDeviceId } from '@/lib/devices';
import { refreshRealtimeDevices } from '@/lib/realtime-monitor';

export async function POST(request, context) {
  const user = await getUserSession(request);
  if (!user || user.role !== 'superadmin') return NextResponse.json({ error: 'Hanya Super Admin yang dapat menguji koneksi.' }, { status: 403 });
  const { id } = await context.params;
  const device = await findDevice(parseDeviceId(id));
  if (!device) return NextResponse.json({ error: 'Mesin tidak ditemukan.' }, { status: 404 });

  if (isDeviceBusy(device)) {
    return NextResponse.json({ error: 'Mesin sedang dipakai sinkronisasi. Tunggu hingga selesai sebelum menguji kesiapan.' }, { status: 409 });
  }

  try {
    const result = await runDeviceJob(device, 'probe', () => probeZkDevice(device));
    const machine = result.machine || {};
    return NextResponse.json({
      online: true,
      ready: true,
      machine,
      message: `Handshake ZKTeco berhasil. Mesin siap sinkronisasi (${machine.userCount || 0} pengguna, ${machine.logCount || 0} log).`,
    });
  } catch (error) {
    return NextResponse.json({
      online: false,
      ready: false,
      probeStatus: 'unavailable',
      error: `Handshake ZKTeco gagal: ${describeZkError(error)}`,
      message: 'Mesin belum siap untuk sinkronisasi. Periksa daya, kabel jaringan, IP/port, dan profil firmware.',
    });
  } finally {
    // runDeviceJob menghentikan listener realtime agar tidak berbagi socket;
    // aktifkan lagi setelah probe selesai.
    refreshRealtimeDevices().catch(() => {});
  }
}
