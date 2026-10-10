import ZKLib from 'node-zklib';

/**
 * Menarik SEMUA data dari mesin ZKTeco:
 * - users: daftar karyawan yang terdaftar di mesin
 * - logs: seluruh log absensi
 */
export async function getZkData() {
  const ip = process.env.ZK_IP || '192.168.1.100';
  const port = parseInt(process.env.ZK_PORT || '4370', 10);

  if (process.env.MOCK_ZK === 'true') {
    console.log('[Mock] Fetching ZK Data...');
    return mockZkData();
  }

  console.log(`Connecting to ZKTeco machine at ${ip}:${port}`);
  // Timeout 40000ms (40 detik) agar muat menarik ~30.000 log tanpa terputus
  const zkInstance = new ZKLib(ip, port, 40000, 4000);
  let users = [];
  let logs = [];

  try {
    await zkInstance.createSocket();
    console.log('Socket connected. Pulling users...');

    // Tarik data karyawan dari mesin
    try {
      const usersResult = await zkInstance.getUsers();
      users = usersResult?.data || [];
      console.log(`Pulled ${users.length} users from machine.`);
    } catch (e) {
      console.warn('Could not pull users from machine (non-fatal):', e.message);
    }

    // Tarik data log absensi dari mesin dengan retry jika perlu
    console.log('Pulling attendance logs...');
    let logsResult = null;
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        logsResult = await zkInstance.getAttendances();
        if (logsResult) break;
      } catch (err) {
        console.warn(`Pull attendances attempt ${attempts}/3 failed: ${err.message}`);
        if (attempts >= 3) throw err;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    logs = logsResult?.data || [];
    console.log(`Pulled ${logs.length} attendance logs from machine.`);

  } catch (e) {
    console.error('Error reading from ZKTeco:', e);
    throw e;
  } finally {
    // KRITIKAL: Selalu putus koneksi agar CPU mesin tidak hang
    try {
      await zkInstance.disconnect();
      console.log('Disconnected from ZKTeco machine safely.');
    } catch (err) {
      console.error('Error disconnecting ZKTeco:', err);
    }
  }

  return { users, logs };
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
