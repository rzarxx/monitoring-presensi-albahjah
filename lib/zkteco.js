import ZKLib from 'node-zklib';
import { COMMANDS, MAX_CHUNK } from 'node-zklib/constants';
import { createTCPHeader, decodeTCPHeader, exportErrorMessage } from 'node-zklib/utils';

const TCP_MAGIC = Buffer.from([0x50, 0x50, 0x82, 0x7d]);
const CMD_REG_EVENT = 500;
const CMD_DATA = 1501;
const EF_ATTLOG = 1;
const TRAILING_PACKET_WAIT = 350;
const USERS_STAGE_LIMIT = 60000;
const LOGS_STAGE_LIMIT = 150000;
const PROBE_STAGE_LIMIT = 12000;
const CHUNK_TIMEOUT = 15000;

function isRealtimeEvent(data) {
  const packet = data.length >= 8 && data.subarray(0, 4).equals(TCP_MAGIC) ? data.subarray(8) : data;
  return packet.length >= 6 && packet.readUInt16LE(0) === CMD_REG_EVENT && packet.readUInt16LE(4) === EF_ATTLOG;
}

const deviceJobs = globalThis.__zkDeviceJobs || (globalThis.__zkDeviceJobs = new Map());
// Menyimpan fungsi pemutus sesi live listener per mesin agar saat sync manual/penuh
// berjalan, koneksi live listener dilepas terlebih dahulu tanpa terkena ECONNRESET.
const liveStoppers = globalThis.__zkLiveStoppers || (globalThis.__zkLiveStoppers = new Map());
const deviceStatuses = globalThis.__zkDeviceStatuses || (globalThis.__zkDeviceStatuses = new Map());

export function deviceKey(device) {
  return `${device?.host || process.env.ZK_IP}:${device?.port || process.env.ZK_PORT || 4370}`;
}

export function isDeviceBusy(device) {
  return deviceJobs.has(deviceKey(device));
}

export function setDeviceOnlineStatus(device, online) {
  deviceStatuses.set(deviceKey(device), { online: Boolean(online), updatedAt: Date.now() });
}

export function getDeviceOnlineStatus(device) {
  return deviceStatuses.get(deviceKey(device)) || null;
}

export function registerLiveStopper(device, stopper) {
  liveStoppers.set(deviceKey(device), stopper);
}

export function unregisterLiveStopper(device, stopper) {
  const key = deviceKey(device);
  if (!stopper || liveStoppers.get(key) === stopper) {
    liveStoppers.delete(key);
  }
}

/**
 * Menjalankan `task` secara eksklusif per mesin. Jika ada live-listener yang sedang
 * membuka socket ke mesin ini, live-listener dihentikan sementara agar tidak bentrok.
 */
export async function runDeviceJob(device, mode, task, canJoin = () => false) {
  const key = deviceKey(device);
  while (deviceJobs.has(key)) {
    const running = deviceJobs.get(key);
    if (canJoin(running.mode)) return { ...(await running.promise), joined: true };
    await running.promise.catch(() => {});
  }

  // Jika ada sesi real-time listener aktif di mesin ini, minta ia melepas socket dulu
  const stopper = liveStoppers.get(key);
  if (stopper) {
    liveStoppers.delete(key);
    await Promise.resolve(stopper()).catch(() => {});
  }

  const promise = Promise.resolve().then(task).finally(() => {
    if (deviceJobs.get(key)?.promise === promise) deviceJobs.delete(key);
  });
  deviceJobs.set(key, { mode, promise });
  return promise;
}

export function describeZkError(error) {
  const inner = error?.err || error;
  const code = inner?.code;
  const message = String(inner?.message || '');
  if (code === 'ECONNRESET') return 'Koneksi diputus oleh mesin karena ada koneksi lain yang sedang aktif. Coba lagi beberapa saat.';
  if (code === 'ECONNREFUSED') return 'Mesin menolak koneksi. Periksa IP/port mesin.';
  if (['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code) || /TIMEOUT_ON_WRITING|socket timeout/i.test(message)) {
    return 'Mesin tidak dapat dijangkau. Pastikan mesin menyala dan terhubung ke jaringan.';
  }
  if (code === 'ZK_STALLED') return message;
  if (/TIMEOUT/i.test(message)) return 'Mesin terlalu lama merespons saat mengirim data. Coba lagi beberapa saat.';
  if (/Socket isn't connected/i.test(message)) return 'Koneksi ke mesin terputus sebelum data selesai diambil.';
  return message || 'Terjadi kesalahan saat membaca data mesin.';
}

function isTransient(error) {
  const inner = error?.err || error;
  return inner?.code === 'ECONNRESET' || /TIMEOUT|Socket isn't connected/i.test(String(inner?.message || ''));
}

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
      buffer = Buffer.concat([buffer, data]);
      let packetLength = 0;
      for (;;) {
        const start = buffer.indexOf(TCP_MAGIC);
        if (start < 0) {
          buffer = buffer.subarray(Math.max(0, buffer.length - (TCP_MAGIC.length - 1)));
          return armTimeout();
        }
        if (start > 0) buffer = buffer.subarray(start);
        if (buffer.length < 16) return armTimeout();
        packetLength = 8 + buffer.readUInt32LE(4);
        if (buffer.length < packetLength) return armTimeout();
        const packet = buffer.subarray(0, packetLength);
        const isEmptyAck = packet.readUInt16LE(8) !== CMD_DATA && packetLength <= 16;
        if (!isEmptyAck && !isRealtimeEvent(packet)) break;
        buffer = buffer.subarray(packetLength);
      }
      if (buffer.readUInt16LE(8) !== CMD_DATA) return finish(resolve, buffer.subarray(0, packetLength));
      clearTimeout(timer);
      timer = setTimeout(() => finish(resolve, buffer.subarray(0, packetLength)), TRAILING_PACKET_WAIT);
    };
    this.socket.on('data', onData);
    this.socket.write(msg, null, (err) => (err ? finish(reject, err) : armTimeout()));
  });
}

/**
 * Pengganti `readWithBuffer` bawaan node-zklib yang bebas dari bug:
 * 1. Listener `handleOnData` dan `onClose` selalu dilepas saat selesai (tidak bocor antar tahap).
 * 2. Menggunakan loop `while` untuk mengekstrak seluruh paket TCP yang datang menyatu di buffer.
 * 3. Mengambil chunk satu per satu secara sekuensial agar buffer TCP mesin ZKTeco tidak overflow.
 */
function reliableReadWithBuffer(reqData, cb = null) {
  return new Promise(async (resolve, reject) => {
    this.replyId++;
    const buf = createTCPHeader(COMMANDS.CMD_DATA_WRRQ, this.sessionId, this.replyId, reqData);
    let reply = null;

    try {
      reply = await this.requestData(buf);
    } catch (err) {
      return reject(err);
    }

    const header = decodeTCPHeader(reply.subarray(0, 16));
    switch (header.commandId) {
      case COMMANDS.CMD_DATA: {
        return resolve({ data: reply.subarray(16), mode: 8 });
      }
      case COMMANDS.CMD_ACK_OK:
      case COMMANDS.CMD_PREPARE_DATA: {
        const recvData = reply.subarray(16);
        const totalSize = recvData.readUIntLE(1, 4);
        if (totalSize <= 0) {
          return resolve({ data: Buffer.alloc(0), err: null });
        }

        const chunks = [];
        for (let offset = 0; offset < totalSize; offset += MAX_CHUNK) {
          chunks.push({ start: offset, size: Math.min(MAX_CHUNK, totalSize - offset) });
        }

        let replyData = Buffer.alloc(0);
        let chunkBuffer = Buffer.alloc(0);
        let rawBuffer = Buffer.alloc(0);
        let currentChunkIndex = 0;
        let timer = null;
        let finished = false;

        const cleanupAndResolve = (data, err = null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.socket?.removeListener('data', handleOnData);
          this.socket?.removeListener('close', handleOnClose);
          resolve({ data, err });
        };

        const armChunkTimeout = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            cleanupAndResolve(
              replyData,
              new Error(`TIME OUT !! ${chunks.length - currentChunkIndex} PACKETS REMAIN !`)
            );
          }, CHUNK_TIMEOUT);
        };

        const requestNextChunk = () => {
          if (currentChunkIndex >= chunks.length) {
            return cleanupAndResolve(replyData, null);
          }
          const chunk = chunks[currentChunkIndex];
          chunkBuffer = Buffer.alloc(0);
          armChunkTimeout();
          this.sendChunkRequest(chunk.start, chunk.size);
        };

        const handleOnClose = () => {
          cleanupAndResolve(replyData, new Error('Socket is disconnected unexpectedly'));
        };

        const handleOnData = (incoming) => {
          if (finished) return;
          rawBuffer = Buffer.concat([rawBuffer, incoming]);

          // Ekstrak semua paket ZKTeco yang utuh di dalam rawBuffer menggunakan while loop
          while (rawBuffer.length > 0) {
            const magicIndex = rawBuffer.indexOf(TCP_MAGIC);
            if (magicIndex < 0) {
              rawBuffer = rawBuffer.subarray(Math.max(0, rawBuffer.length - (TCP_MAGIC.length - 1)));
              break;
            }
            if (magicIndex > 0) {
              rawBuffer = rawBuffer.subarray(magicIndex);
            }
            if (rawBuffer.length < 16) break;

            const packetPayloadLen = rawBuffer.readUInt32LE(4);
            const fullPacketLen = 8 + packetPayloadLen;
            if (rawBuffer.length < fullPacketLen) break;

            const packet = rawBuffer.subarray(0, fullPacketLen);
            rawBuffer = rawBuffer.subarray(fullPacketLen);

            if (isRealtimeEvent(packet)) continue;

            const cmdId = packet.readUInt16LE(8);
            // Abaikan ACK kosong sisa perintah sebelumnya; kita hanya mengumpulkan payload chunk
            if (cmdId !== COMMANDS.CMD_DATA && cmdId !== COMMANDS.CMD_ACK_OK && fullPacketLen <= 16) {
              continue;
            }

            armChunkTimeout();
            chunkBuffer = Buffer.concat([chunkBuffer, packet.subarray(16)]);

            const expectedChunkSize = chunks[currentChunkIndex]?.size || 0;
            // Setiap chunk dibungkus dengan 8 byte sub-header oleh mesin ketika dikirim bertahap,
            // atau langsung sebesar expectedChunkSize.
            if (chunkBuffer.length >= expectedChunkSize + 8) {
              replyData = Buffer.concat([replyData, chunkBuffer.subarray(8, 8 + expectedChunkSize)]);
              currentChunkIndex++;
              cb && cb(replyData.length, totalSize);
              requestNextChunk();
              if (finished) return;
            } else if (cmdId === COMMANDS.CMD_DATA && chunkBuffer.length === expectedChunkSize) {
              replyData = Buffer.concat([replyData, chunkBuffer]);
              currentChunkIndex++;
              cb && cb(replyData.length, totalSize);
              requestNextChunk();
              if (finished) return;
            }
          }
        };

        this.socket.once('close', handleOnClose);
        this.socket.on('data', handleOnData);
        requestNextChunk();
        break;
      }
      default: {
        reject(new Error('ERROR_IN_UNHANDLE_CMD ' + exportErrorMessage(header.commandId)));
      }
    }
  });
}

export function patchZkInstance(zkInstance) {
  if (zkInstance?.zklibTcp) {
    zkInstance.zklibTcp.requestData = requestCompletePacket;
    zkInstance.zklibTcp.readWithBuffer = reliableReadWithBuffer;
  }
  return zkInstance;
}

function withStageLimit(promise, limit, stage) {
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Pembacaan ${stage} dari mesin macet lebih dari ${limit / 1000} detik dan dihentikan. Coba lagi beberapa saat.`);
      error.code = 'ZK_STALLED';
      reject(error);
    }, limit);
  });
  return Promise.race([promise, stalled]).finally(() => clearTimeout(timer));
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

async function pullOnce(ip, port, device = null) {
  const zkInstance = patchZkInstance(new ZKLib(ip, port, 40000, 4000));
  try {
    await zkInstance.createSocket();
    if (device) setDeviceOnlineStatus(device, true);

    const machine = await readMachineInfo(zkInstance);

    let users = [];
    try {
      users = (await withStageLimit(zkInstance.getUsers(), USERS_STAGE_LIMIT, 'daftar user'))?.data || [];
      console.log(`Pulled ${users.length} users from machine.`);
    } catch (e) {
      if (e?.code === 'ZK_STALLED') throw e;
      console.warn('Could not pull users from machine (non-fatal):', describeZkError(e));
    }

    const logsResult = await withStageLimit(zkInstance.getAttendances(), LOGS_STAGE_LIMIT, 'log absensi');
    const partial = logsResult?.err ? describeZkError(logsResult.err) : null;
    if (partial) console.warn('Attendance pull ended early:', partial);
    const logs = logsResult?.data || [];
    console.log(`Pulled ${logs.length} attendance logs from machine${machine ? ` (machine reports ${machine.logCount})` : ''}.`);
    return { users, logs, machine, partial };
  } finally {
    try {
      await zkInstance.disconnect();
    } catch (err) {
      console.warn('Error disconnecting ZKTeco:', describeZkError(err));
    }
  }
}

export async function getZkData(device = null) {
  const ip = device?.host || process.env.ZK_IP || '192.168.1.100';
  const port = parseInt(device?.port || process.env.ZK_PORT || '4370', 10);

  if (process.env.MOCK_ZK === 'true') {
    console.log('[Mock] Fetching ZK Data...');
    if (device) setDeviceOnlineStatus(device, true);
    return mockZkData();
  }

  console.log(`Connecting to ZKTeco machine at ${ip}:${port}`);
  for (let attempt = 1; ; attempt++) {
    try {
      return await pullOnce(ip, port, device);
    } catch (error) {
      console.error(`ZKTeco pull attempt ${attempt}/3 failed:`, describeZkError(error));
      if (attempt >= 3 || !isTransient(error)) {
        if (device) setDeviceOnlineStatus(device, false);
        const wrapped = new Error(describeZkError(error));
        wrapped.cause = error;
        throw wrapped;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

/**
 * Uji kesiapan ringan: buka sesi ZKTeco lalu baca informasi mesin. Ini sengaja
 * tidak mengambil user atau log absensi agar aman digunakan dari halaman Mesin.
 */
export async function probeZkDevice(device) {
  const ip = device?.host || process.env.ZK_IP || '192.168.1.100';
  const port = parseInt(device?.port || process.env.ZK_PORT || '4370', 10);

  if (process.env.MOCK_ZK === 'true') {
    if (device) setDeviceOnlineStatus(device, true);
    return { machine: { userCount: 2, logCount: 2 } };
  }

  const zkInstance = patchZkInstance(new ZKLib(ip, port, 10000, 4000));
  try {
    await zkInstance.createSocket();
    const info = await withStageLimit(zkInstance.getInfo(), PROBE_STAGE_LIMIT, 'informasi mesin');
    if (device) setDeviceOnlineStatus(device, true);
    return {
      machine: {
        userCount: Number(info?.userCounts || 0),
        logCount: Number(info?.logCounts || 0),
      },
    };
  } catch (error) {
    if (device) setDeviceOnlineStatus(device, false);
    throw error;
  } finally {
    try {
      await zkInstance.disconnect();
    } catch (error) {
      console.warn('Error disconnecting ZKTeco after probe:', describeZkError(error));
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
