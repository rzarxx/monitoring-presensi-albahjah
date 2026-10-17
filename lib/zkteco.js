import ZKLib from 'node-zklib';

const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
const CMD_REG_EVENT = 500;
const EF_ATTLOG = 1;

// Sama dengan checkNotEventTCP di node-zklib: paket notifikasi scan real-time.
function isRealtimeEvent(data) {
  const packet = data.length >= 8 && data.subarray(0, 4).equals(TCP_MAGIC) ? data.subarray(8) : data;
  return packet.length >= 6 && packet.readUInt16LE(0) === CMD_REG_EVENT && packet.readUInt16LE(4) === EF_ATTLOG;
}

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

// node-zklib menganggap balasan CMD_DATA selesai setelah 1 detik tanpa paket baru,
// sehingga data yang tiba tersendat terpotong diam-diam (mis. 2 dari 5 log). Versi
// ini memakai panjang paket di header TCP ZKTeco dan menunggu sampai paket utuh.
function requestCompletePacket(msg) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let timer = null;
    const finish = (callback, value) => {
      clearTimeout(timer);
      this.socket?.removeListener('data', onData);
      callback(value);
    };
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error('TIMEOUT_ON_RECEIVING_REQUEST_DATA')), this.timeout);
    };
    const onData = (data) => {
      // Notifikasi scan real-time bukan balasan permintaan ini.
      if (buffer.length === 0 && isRealtimeEvent(data)) return;
      buffer = Buffer.concat([buffer, data]);
      armTimeout();
      if (buffer.length < 8) return;
      const packetLength = 8 + buffer.readUInt32LE(4);
      if (buffer.length >= packetLength) finish(resolve, buffer.subarray(0, packetLength));
    };
    this.socket.on('data', onData);
    this.socket.write(msg, null, (err) => (err ? finish(reject, err) : armTimeout()));
  });
}

async function readMachineInfo(zkInstance) {
  try {
    const info = await zkInstance.getInfo();
    return { userCount: info.userCounts, logCount: info.logCounts };
  } catch (e) {
    console.warn('Could not read machine info (non-fatal):', describeZkError(e));
    return null;
  }
}

async function pullOnce(ip, port) {
  // Timeout 40000ms (40 detik) agar muat menarik ~30.000 log tanpa terputus
  const zkInstance = new ZKLib(ip, port, 40000, 4000);
  zkInstance.zklibTcp.requestData = requestCompletePacket;
  try {
    await zkInstance.createSocket();

    const machine = await readMachineInfo(zkInstance);

    let users = [];
    try {
      users = (await zkInstance.getUsers())?.data || [];
      console.log(`Pulled ${users.length} users from machine.`);
    } catch (e) {
      console.warn('Could not pull users from machine (non-fatal):', describeZkError(e));
    }

    const logsResult = await zkInstance.getAttendances();
    const partial = logsResult?.err ? describeZkError(logsResult.err) : null;
    if (partial) console.warn('Attendance pull ended early:', partial);
    const logs = logsResult?.data || [];
    console.log(`Pulled ${logs.length} attendance logs from machine${machine ? ` (machine reports ${machine.logCount})` : ''}.`);
    return { users, logs, machine, partial };
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
    ],
    machine: { userCount: 2, logCount: 2 },
    partial: null,
  };
}
