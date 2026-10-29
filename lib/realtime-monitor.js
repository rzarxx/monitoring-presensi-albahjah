import ZKLib from 'node-zklib';
import { COMMANDS } from 'node-zklib/constants';
import { createTCPHeader, decodeRecordRealTimeLog52 } from 'node-zklib/utils';
import { query } from '@/lib/db';
import { emitRealtimeEvent } from '@/lib/events';
import { autoLinkEnrollments, ensureEnrollments } from '@/lib/enrollments';
import {
  isDeviceBusy,
  patchZkInstance,
  registerLiveStopper,
  setDeviceOnlineStatus,
  unregisterLiveStopper,
} from '@/lib/zkteco';

const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 5 * 60 * 1000;
const STABLE_CONNECTION_MS = 60 * 1000;
const pad = (value) => String(value).padStart(2, '0');
const formatLocal = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

const monitorState = globalThis.__zkRealtimeMonitor || (globalThis.__zkRealtimeMonitor = {
  started: false,
  workers: new Map(), // deviceId -> { stop: fn }
});

function isValidDeviceHost(device) {
  if (!device || !device.is_active) return false;
  if (!device.host || device.host === '0.0.0.0' || !device.port || Number(device.port) <= 0) return false;
  return true;
}

async function saveRealtimeScan(device, payload) {
  const uid = Number.parseInt(payload?.userId, 10);
  const attTime = payload?.attTime instanceof Date ? payload.attTime : new Date(payload?.attTime);
  if (!Number.isInteger(uid) || Number.isNaN(attTime.getTime())) return;

  const timestamp = formatLocal(attTime);
  await query(
    `INSERT IGNORE INTO attendance_logs (device_id, uid, timestamp, state) VALUES (?, ?, ?, 0)`,
    [device.id, uid, timestamp]
  );
  await ensureEnrollments(device.id, [uid]);
  await autoLinkEnrollments(device.id);

  emitRealtimeEvent('attendance', {
    device_id: device.id,
    uid,
    timestamp,
    realtime: true,
  });
}

function createDeviceWorker(device) {
  let stopped = false;
  let currentZk = null;
  let reconnectTimer = null;
  let keepaliveTimer = null;
  let releaseResolve = null;
  let reconnectAttempts = 0;
  let connectedAt = 0;

  const closeCurrentSession = async () => {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    const zk = currentZk;
    currentZk = null;
    if (zk) {
      try {
        await zk.disconnect();
      } catch {}
    }
    if (releaseResolve) {
      const r = releaseResolve;
      releaseResolve = null;
      r();
    }
  };

  const pauseForManualJob = async () => {
    await closeCurrentSession();
  };

  const scheduleReconnect = (reason, { busy = false } = {}) => {
    if (stopped || reconnectTimer) return;

    // Pekerjaan sinkronisasi aktif bukan kegagalan koneksi: cek lagi segera
    // setelah socket sinkronisasi selesai, tanpa menaikkan backoff perangkat.
    const delayMs = busy
      ? 1500
      : Math.min(
        RECONNECT_BASE_DELAY_MS * (2 ** Math.min(reconnectAttempts++, 6)),
        RECONNECT_MAX_DELAY_MS
      );

    console.warn(
      `[RealtimeMonitor] ${device.name} (${device.host}:${device.port}) ${reason}; ` +
      `retry dalam ${Math.ceil(delayMs / 1000)} detik${busy ? '' : ` (percobaan ${reconnectAttempts})`}.`
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectLoop();
    }, delayMs);
  };

  const connectLoop = async () => {
    if (stopped) return;
    if (process.env.MOCK_ZK === 'true') {
      setDeviceOnlineStatus(device, true);
      return;
    }
    if (isDeviceBusy(device)) {
      scheduleReconnect('sedang dipakai sinkronisasi', { busy: true });
      return;
    }

    const ip = device.host;
    const port = Number.parseInt(device.port || '4370', 10);
    const zk = patchZkInstance(new ZKLib(ip, port, 15000, 4000));
    currentZk = zk;
    registerLiveStopper(device, pauseForManualJob);

    try {
      await zk.createSocket(
        () => {
          setDeviceOnlineStatus(device, false);
        },
        () => {
          if (!stopped && currentZk === zk) {
            setDeviceOnlineStatus(device, false);
            emitRealtimeEvent('machine_status', { device_id: device.id, online: false });
            if (connectedAt && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
              reconnectAttempts = 0;
            }
            connectedAt = 0;
            scheduleReconnect('koneksi realtime terputus');
          }
        }
      );

      if (stopped || currentZk !== zk) {
        await closeCurrentSession();
        return;
      }

      setDeviceOnlineStatus(device, true);
      emitRealtimeEvent('machine_status', { device_id: device.id, online: true });
      connectedAt = Date.now();

      const tcp = zk.zklibTcp;
      if (tcp?.socket) {
        // Matikan idle socket timeout supaya koneksi real-time listener tetap hidup
        tcp.socket.setTimeout(0);
        tcp.socket.setKeepAlive(true, 10000);

        // Daftarkan semua event mesin (EF_ATTLOG | EF_ENROLLUSER | EF_ENROLLFINGER = 0xFFFF)
        tcp.replyId++;
        const regBuf = createTCPHeader(
          COMMANDS.CMD_REG_EVENT,
          tcp.sessionId,
          tcp.replyId,
          Buffer.from([0xff, 0xff, 0x00, 0x00])
        );
        tcp.socket.write(regBuf);

        let streamBuf = Buffer.alloc(0);
        const onData = (chunk) => {
          streamBuf = Buffer.concat([streamBuf, chunk]);
          while (streamBuf.length >= 16) {
            const idx = streamBuf.indexOf(TCP_MAGIC);
            if (idx < 0) {
              streamBuf = streamBuf.subarray(Math.max(0, streamBuf.length - 3));
              break;
            }
            if (idx > 0) streamBuf = streamBuf.subarray(idx);
            if (streamBuf.length < 16) break;
            const payloadLen = streamBuf.readUInt32LE(4);
            const totalLen = 8 + payloadLen;
            if (streamBuf.length < totalLen) break;

            const packet = streamBuf.subarray(0, totalLen);
            streamBuf = streamBuf.subarray(totalLen);

            const cmdId = packet.readUInt16LE(8);
            const eventType = packet.readUInt16LE(12);

            if (cmdId === COMMANDS.CMD_REG_EVENT) {
              // Balas ACK ke mesin agar mesin tahu event sudah diterima
              const ackHeader = createTCPHeader(COMMANDS.CMD_ACK_OK, tcp.sessionId, 0, '');
              tcp.socket?.write(ackHeader);

              if (eventType === COMMANDS.EF_ATTLOG && packet.length >= 40) {
                try {
                  const decoded = decodeRecordRealTimeLog52(packet);
                  saveRealtimeScan(device, decoded).catch((err) =>
                    console.error(`[RealtimeMonitor] Save scan error on ${device.name}:`, err.message)
                  );
                } catch (err) {
                  console.error(`[RealtimeMonitor] Decode error on ${device.name}:`, err.message);
                }
              }
            }
          }
        };

        tcp.socket.on('data', onData);
      }
    } catch {
      setDeviceOnlineStatus(device, false);
      emitRealtimeEvent('machine_status', { device_id: device.id, online: false });
      await closeCurrentSession();
      scheduleReconnect('tidak dapat tersambung');
    }
  };

  connectLoop();

  return {
    device,
    stop: async () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      unregisterLiveStopper(device, pauseForManualJob);
      await closeCurrentSession();
    },
    kick: () => {
      if (!stopped && !currentZk && !isDeviceBusy(device)) {
        scheduleReconnect('memulai ulang listener realtime');
      }
    },
  };
}

export async function refreshRealtimeDevices() {
  try {
    const devices = await query(`SELECT id, code, name, host, port, is_active FROM devices WHERE is_active = 1`);
    const activeIds = new Set();

    for (const dev of devices) {
      if (!isValidDeviceHost(dev)) continue;
      activeIds.add(dev.id);
      const existing = monitorState.workers.get(dev.id);
      if (existing) {
        if (existing.device.host !== dev.host || Number(existing.device.port) !== Number(dev.port)) {
          await existing.stop();
          monitorState.workers.set(dev.id, createDeviceWorker(dev));
        } else {
          existing.kick();
        }
      } else {
        monitorState.workers.set(dev.id, createDeviceWorker(dev));
      }
    }

    for (const [id, worker] of monitorState.workers.entries()) {
      if (!activeIds.has(id)) {
        await worker.stop();
        monitorState.workers.delete(id);
      }
    }
  } catch (err) {
    // Database mungkin belum siap saat startup awal; dicoba lagi pada siklus berikutnya
    console.warn('[RealtimeMonitor] Could not refresh devices:', err.message);
  }
}

export function ensureRealtimeMonitorStarted() {
  if (monitorState.started) return;
  monitorState.started = true;
  // Muat sekali saat proses server hidup. Perubahan konfigurasi mesin memanggil
  // refreshRealtimeDevices() langsung dari endpoint CRUD, jadi tidak perlu
  // polling database berkala.
  refreshRealtimeDevices();
}
