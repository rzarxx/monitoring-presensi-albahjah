import { query } from '@/lib/db';
import { sameName } from '@/lib/names';

// device_enrollments memetakan (mesin, UID mesin) ke Pejuang lewat employee_uid.
// Nomor UID tiap mesin berdiri sendiri, jadi UID yang sama di mesin lain bisa
// milik orang berbeda. link_locked = 1 menandai keputusan manual (hubungkan atau
// lepas) yang tidak boleh diubah oleh penghubungan otomatis.

/**
 * Menghubungkan user mesin yang belum terpetakan ke Pejuang bila nomor UID-nya
 * sama DAN namanya cocok. Nomor sama dengan nama berbeda dibiarkan untuk
 * diputuskan manual.
 */
export async function autoLinkEnrollments(deviceId = null) {
  const rows = await query(`
    SELECT de.id, de.display_name, e.name AS employee_name
    FROM device_enrollments de
    JOIN employees e ON e.uid = de.device_uid
    WHERE de.employee_uid IS NULL AND de.link_locked = 0${deviceId ? ' AND de.device_id = ?' : ''}
  `, deviceId ? [deviceId] : []);
  const ids = rows.filter((row) => sameName(row.employee_name, row.display_name)).map((row) => row.id);
  if (ids.length) await query(`UPDATE device_enrollments SET employee_uid = device_uid WHERE id IN (?)`, [ids]);
  return ids.length;
}

/** Memastikan setiap UID yang pernah scan punya baris pemetaan, termasuk user yang sudah dihapus dari mesin. */
export async function ensureEnrollments(deviceId, deviceUids) {
  const unique = [...new Set(deviceUids)];
  for (let index = 0; index < unique.length; index += 1000) {
    const values = unique.slice(index, index + 1000).map((uid) => [deviceId, uid, '']);
    await query(`INSERT IGNORE INTO device_enrollments (device_id, device_uid, display_name) VALUES ?`, [values]);
  }
}

export async function setEnrollmentLink(deviceId, deviceUid, employeeUid) {
  const result = await query(
    `UPDATE device_enrollments SET employee_uid = ?, link_locked = 1 WHERE device_id = ? AND device_uid = ?`,
    [employeeUid, deviceId, deviceUid]
  );
  return result.affectedRows > 0;
}

/** Nomor Pejuang baru: pakai UID mesin bila belum dipakai, selain itu nomor bebas berikutnya. */
export async function allocateEmployeeUids(preferred) {
  const rows = await query(`SELECT uid FROM employees`);
  return pickEmployeeUids(rows.map((row) => row.uid), preferred);
}

// Dua tahap: nomor UID mesin yang masih bebas diberikan dulu ke pemiliknya,
// baru sisanya mendapat nomor baru, supaya nomor bebas tidak "dicuri" entri lain.
export function pickEmployeeUids(takenUids, preferred) {
  const taken = new Set(takenUids);
  const result = preferred.map((wanted) => {
    if (!Number.isInteger(wanted) || wanted < 1 || taken.has(wanted)) return null;
    taken.add(wanted);
    return wanted;
  });
  let next = Math.max(0, ...taken) + 1;
  return result.map((uid) => {
    if (uid !== null) return uid;
    while (taken.has(next)) next++;
    taken.add(next);
    return next;
  });
}
