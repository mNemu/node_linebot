import moment from '../lib/moment.js';
import { makeFlexDiet } from '../line/flexDiet.js';

/** Projects a weight-change trajectory from fWeight/fDate to tWeight/tDate,
 * stepping daily (<=30 days), weekly (<=210 days) or monthly (>210 days).
 * Ported from diet.gs's diet(), now rendered as a Flex Message. */
export function diet(tWeight, tDate, fWeight, fDate) {
  const mid = tDate.diff(fDate, 'd');
  const dfp = (tWeight - fWeight) / fWeight;
  const mdfp = -(1 - Math.pow(1 + dfp, 30 / mid));

  const flexDiet = makeFlexDiet(dfp * 100, mdfp * 100);
  flexDiet.addRow(fDate.format('MM/DD(ddd)'), fWeight, { emphasis: true });

  let nDate;
  let step;
  if (mid > 210) {
    nDate = fDate.clone();
    if (fDate.date() < tDate.date()) {
      nDate = fDate.clone().add(-1, 'M');
    }
    step = (base) => {
      let pDate = base.clone().date(1).add(2, 'M').add(-1, 'd');
      if (tDate.date() < pDate.date()) {
        pDate = pDate.date(tDate.date());
      }
      return pDate;
    };
  } else if (mid > 30) {
    const fn = mid - 7 * Math.ceil(mid / 7);
    nDate = fDate.clone().add(fn, 'd');
    step = (base) => base.clone().add(7, 'd');
  } else {
    nDate = fDate.clone();
    step = (base) => base.clone().add(1, 'd');
  }

  let i;
  do {
    nDate = step(nDate);
    i = nDate.diff(fDate, 'd');
    const adfp = Math.pow(1 + dfp, i / mid);
    flexDiet.addRow(nDate.format('MM/DD(ddd)'), fWeight * adfp, { emphasis: i >= mid });
  } while (i < mid);

  return flexDiet.messages();
}

export function doDiet(key) {
  const padded = ` ${key} `;
  if (/^ *diet *[0-9.]* *[0-9]{1,2}\/[0-9]{1,2} *[0-9.]*/.test(padded)) {
    const parts = key.replace(/^\s+/, '').split(/\s+/);
    const tDate = moment(parts[2], 'M/D');
    let fDate = moment(moment().format('YYYY-MM-DD 00:00:00'));
    if (parts[4]) {
      fDate = moment(parts[4], 'M/D');
    }
    if (fDate >= tDate) {
      tDate.add(1, 'y');
    }
    return diet(Number(parts[1]), tDate, Number(parts[3]), fDate);
  }
  return 'diet 目標値 目標日 初期値 [開始日]\n' + '30日以下 日次 210日以下 週次 それ以上 月次の変動値を表示';
}
