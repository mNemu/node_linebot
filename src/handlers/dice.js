import { makeFlexDice } from '../line/flexDice.js';

/** nDm dice roll, e.g. "2D6". Ported from common.gs's dice(), now rendered as a Flex Message. */
export function dice(key) {
  const times = key.match(/\d{1,3}/g);
  const count = Number(times[0]);
  const sides = Number(times[1]);
  const results = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const d = Math.floor(Math.random() * sides) + 1;
    results.push(d);
    sum += d;
  }
  return makeFlexDice(count, sides, results, sum);
}
