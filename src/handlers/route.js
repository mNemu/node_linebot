import { Client, TravelMode } from '@googlemaps/google-maps-services-js';
import { config } from '../config.js';

const mapsClient = new Client({});

const MODE_LABEL = {
  [TravelMode.walking]: '歩 ::',
  [TravelMode.transit]: '電 ::',
  [TravelMode.driving]: '車 ::',
};

async function fetchRoute(from, to, mode, date) {
  const res = {
    header: '',
    summary: '',
    body: '',
  };

  const response = await mapsClient.directions({
    params: {
      origin: from,
      destination: to,
      mode,
      language: 'ja',
      departure_time: Math.floor(date.getTime() / 1000),
      key: config.maps.apiKey,
    },
  });

  if (response.data.status === 'ZERO_RESULTS' || response.data.routes.length === 0) {
    res.summary = `${MODE_LABEL[mode]}  検索結果なし`;
    return res;
  }

  for (const route of response.data.routes) {
    const leg = route.legs[0];
    let msg = `発: ${leg.start_address.replace(/^.*〒\d{3}-\d{4} /, '')}\n`;
    msg += `着: ${leg.end_address.replace(/^.*〒\d{3}-\d{4} /, '')}`;
    res.header = msg;
    msg = '';
    msg += `${MODE_LABEL[mode]} ${leg.duration.text} `;
    msg += `${route.summary} `;
    msg += leg.distance.text;
    msg += route.fare === undefined ? '' : route.fare.text;
    res.summary = msg;

    res.body = leg.steps
      .filter((step) => step.travel_mode !== 'DRIVING' || step.html_instructions.indexOf('有料区間') >= 0)
      .map((step) => {
        let ret = `   ${step.duration.text} : `;
        switch (step.travel_mode) {
          case 'WALKING':
            ret += step.html_instructions;
            break;
          case 'TRANSIT':
            ret += `${step.transit_details.departure_stop.name}->`;
            ret += step.transit_details.arrival_stop.name;
            ret += ` ${step.transit_details.line.name}`;
            break;
          case 'DRIVING':
            ret += step.html_instructions;
            break;
          default:
            ret += ` ${step.distance.text}`;
        }
        return ret;
      })
      .join('\n');
  }

  return res;
}

export async function getRoute(key) {
  const from = key.slice(0, key.indexOf('から')).trim();
  const to = key.slice(key.indexOf('から') + 2).trim();
  const now = new Date();
  const rt1 = await fetchRoute(from, to, TravelMode.driving, now);
  const rt2 = await fetchRoute(from, to, TravelMode.transit, now);

  let msg = rt1.header + '\n' + rt1.summary + (rt1.body === '' ? '\n' : ' 有料区間あり\n');
  msg += rt2.summary + (rt2.body !== '' ? '\n' + rt2.body : '');
  msg += '\nhttps://www.google.com/search?q=' + encodeURI(`${from}から${to}`);
  return msg;
}

export function doRoutes(key) {
  const subkey = key.slice(key.indexOf(':') + 1).trim();
  if (/^ *登録/.test(subkey)) {
    const subkeys = subkey.split('\n');
    return subkeys.length === 1 ? '登録内容' : subkeys.slice(1).join();
  }
  if (/^.*まで/.test(subkey)) {
    return 'まで';
  }
  return 'def';
}
