// Dipakai server dan browser. scripts/migrate-employee-mapping.js memuat salinan
// fungsi yang sama karena berjalan di luar bundler Next.js.
export function normalizeName(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
}

// Nama di mesin sering disingkat atau tanpa spasi ("EvaPurnamasari"), jadi
// cukup salah satu memuat yang lain untuk dianggap orang yang sama.
export function sameName(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}
