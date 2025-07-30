export function formatDateTime(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const h = String(dt.getHours()).padStart(2, "0");
  const min = String(dt.getMinutes()).padStart(2, "0");
  const s = String(dt.getSeconds()).padStart(2, "0");
  return `${y}/${m}/${d} ${h}:${min}:${s}`;
}
