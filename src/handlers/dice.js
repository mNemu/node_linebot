/** nDm dice roll, e.g. "2D6". Ported from common.gs's dice(). */
export function dice(key) {
  const times = key.match(/\d{1,3}/g);
  const count = Number(times[0]);
  const sides = Number(times[1]);
  let sum = 0;
  let msg = '';
  for (let i = 0; i < count; i++) {
    const d = Math.floor(Math.random() * sides) + 1;
    sum += d;
    msg += `${d} `;
  }
  return `合計 ${sum}\n出目${msg}です`;
}
