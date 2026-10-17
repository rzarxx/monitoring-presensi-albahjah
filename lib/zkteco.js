import ZKLib from 'node-zklib';

// Mesin ZKTeco hanya melayani satu sesi pada satu waktu. Sesi kedua (tab lain,
// auto-sync, atau cek status) membuat sesi pertama diputus (ECONNRESET), jadi
// semua akses ke satu mesin harus lewat antrean ini.
const deviceJobs = globalThis.__zkDeviceJobs || (globalThis.__zkDeviceJobs = new Map());

function deviceKey(device) {
  return `${device?.host || process.env.ZK_IP}:${device?.port || process.env.ZK_PORT || 4370}`;
}

export function isDeviceBusy(device) {
  return deviceJobs.has(deviceKey(device));
}

/**
 * Menjalankan `task` secara eksklusif per mesin. Jika pekerjaan yang setara
 * sedang berjalan (`canJoin` bernilai true), hasilnya dipakai bersama alih-alih
 * membuka koneksi baru ke mesin.
 */
export async function runDeviceJob(device, mode, task, canJoin = () => false) {
  const key = deviceKey(device);
  while (deviceJobs.has(key)) {
    const running = deviceJobs.get(key);
    if (canJoin(running.mode)) return { ...(await running.promise), joined: true };
    await running.promise.catch(() => {});
  }

  // Entri dihapus di dalam rantai promise itu sendiri, sehingga pihak yang
  // menunggu baru dilanjutkan setelah mesin benar-benar bebas.
  const promise = Promise.resolve().then(task).finally(() => {
    if (deviceJobs.get(key)?.promise === promise) deviceJobs.delete(key);
  });
  deviceJobs.set(key, { mode, promise });
  return promise;
}

/** Mengubah error node-zklib (objek ZKError tanpa `.message`) menjadi pesan yang jelas. */
export function describeZkError(error) {
  const inner = error?.err || error;
  const code = inner?.code;
  const message = String(inner?.message || '');
  if (code === 'ECONNRESET') return 'Koneksi diputus oleh mesin karena ada koneksi lain yang sedang aktif. Coba lagi beberapa saat.';
  if (code === 'ECONNREFUSED') return 'Mesin menolak koneksi. Periksa IP/port mesin.';
  if (['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) || /TIMEOUT_ON_WRITING|socket timeout/i.test(message)) {
    return 'Mesin tidak dapat dijangkau. Pastikan mesin menyala dan terhubung ke jaringan.';
  }
  if (/TIMEOUT/i.test(message)) return 'Mesin terlalu lama merespons saat mengirim data. Coba lagi beberapa saat.';
  if (/Socket isn't connected/i.test(message)) return 'Koneksi ke mesin terputus sebelum data selesai diambil.';
  return message || 'Terjadi kesalahan saat membaca data mesin.';
}

function isTransient(error) {
  const inner = error?.err || error;
  return inner?.code === 'ECONNRESET' || /TIMEOUT|Socket isn't connected/i.test(String(inner?.message || ''));
}

async function pullOnce(ip, port) {
  // Timeout 40000ms (40 detik) agar muat menarik ~30.000 log tanpa terputus
  const zkInstance = new ZKLib(ip, port, 40000, 4000);
  try {
    await zkInstance.createSocket();

    let users = [];
    try {
      users = (await zkInstance.getUsers())?.data || [];
      console.log(`Pulled ${users.length} users from machine.`);
    } catch (e) {
      console.warn('Could not pull users from machine (non-fatal):', describeZkError(e));
    }

    const logsResult = await zkInstance.getAttendances();
    if (logsResult?.err) console.warn('Attendance pull ended early:', describeZkError(logsResult.err));
    const logs = logsResult?.data || [];
    console.log(`Pulled ${logs.length} attendance logs from machine.`);
    return { users, logs };
  } finally {
    // KRITIKAL: Selalu putus koneksi agar CPU mesin tidak hang
    try {
      await zkInstance.disconnect();
    } catch (err) {
      console.warn('Error disconnecting ZKTeco:', describeZkError(err));
    }
  }
}

/**
 * Menarik SEMUA data dari mesin ZKTeco:
 * - users: daftar karyawan yang terdaftar di mesin
 * - logs: seluruh log absensi
 * Pemanggil wajib membungkusnya dengan runDeviceJob agar tidak bertabrakan.
 */
export async function getZkData(device = null) {
  const ip = device?.host || process.env.ZK_IP || '192.168.1.100';
  const port = parseInt(device?.port || process.env.ZK_PORT || '4370', 10);

  if (process.env.MOCK_ZK === 'true') {
    console.log('[Mock] Fetching ZK Data...');
    return mockZkData();
  }

  console.log(`Connecting to ZKTeco machine at ${ip}:${port}`);
  // Ulangi dengan koneksi baru; mengulang di socket yang sudah rusak hampir selalu gagal lagi.
  for (let attempt = 1; ; attempt++) {
    try {
      return await pullOnce(ip, port);
    } catch (error) {
      console.error(`ZKTeco pull attempt ${attempt}/3 failed:`, describeZkError(error));
      if (attempt >= 3 || !isTransient(error)) {
        const wrapped = new Error(describeZkError(error));
        wrapped.cause = error;
        throw wrapped;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

function mockZkData() {
  const now = new Date();
  return {
    users: [
      { userId: '1', name: 'John Doe', role: 0 },
      { userId: '2', name: 'Jane Smith', role: 0 },
    ],
    logs: [
      { deviceUserId: '1', recordTime: new Date(now.getTime() - 1000 * 60 * 5) },
      { deviceUserId: '2', recordTime: new Date(now.getTime() - 1000 * 60 * 10) },
    ]
  };
}
