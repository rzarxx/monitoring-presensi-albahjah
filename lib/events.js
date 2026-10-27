import { EventEmitter } from 'events';

// Singleton Event Bus untuk Server-Sent Events (SSE) lintas request di dalam proses Node.js
const bus = globalThis.__presensiEventBus || (globalThis.__presensiEventBus = new EventEmitter());
bus.setMaxListeners(200);

/**
 * Memancarkan event perubahan data secara real-time ke seluruh tab/browser yang terhubung.
 * @param {string} type - jenis perubahan ('attendance', 'employees', 'leaves', 'devices', 'admins', 'sync', 'machine_status')
 * @param {object} payload - detail perubahan (misal: { device_id, uid, action })
 */
export function emitRealtimeEvent(type, payload = {}) {
  const event = {
    type,
    ...payload,
    timestamp: Date.now(),
  };
  bus.emit('change', event);
}

export function subscribeRealtimeEvents(listener) {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}
