import fs from 'node:fs';
import { newQueue } from '@henrygd/queue';
import { $$fetch } from './_fetch-retry';
import path from 'node:path';
import { asyncWriteToStream } from 'foxts/async-write-to-stream';

interface SpeedTestServer {
  url: string,
  lat: string,
  lon: string,
  distance: number,
  name: string,
  country: string,
  cc: string,
  sponsor: string,
  id: string,
  preferred: number,
  https_functional: number,
  host: string
}

const s = newQueue(2);

const KEYWORDS = [
  'China',
  'China Telecom',
  'China Mobile',
  'China Unicom',
  'Hong Kong',
  'Taiwan',
  'Japan',
  'Tokyo',
  'Osaka',
  'Singapore',
  'Korea',
  'Seoul',
  'Canada',
  'Toronto',
  'Montreal',
  'Los Ang',
  'San Jos',
  'Seattle',
  'New York',
  'Dallas',
  'Miami',
  'Berlin',
  'Frankfurt',
  'London',
  'Paris',
  'Amsterdam',
  'Moscow',
  'Australia',
  'Sydney',
  'Brazil',
  'Turkey'
];

const publicFolder = path.join(__dirname, 'public');

(async () => {
  fs.mkdirSync(publicFolder, { recursive: true });

  const topUserAgents = (await (await $$fetch('https://raw.githubusercontent.com/microlinkhq/top-user-agents/master/src/desktop.json')).json()) as string[];

  const promises: Array<Promise<SpeedTestServer[]>> = KEYWORDS.map(querySpeedtestApi);

  const data = dedupeSpeedTestServersByUrl((await Promise.all(promises)).flat());

  if (data.length === 0) {
    throw new Error('No servers found');
  }

  data.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name) || a.host.localeCompare(b.host));

  const writeStream = fs.createWriteStream(path.join(publicFolder, 'servers.json'));
  let p = asyncWriteToStream(writeStream, '[\n');
  if (p) await p;
  for (let i = 0, len = data.length; i < len; i++) {
    const item = data[i];
    p = asyncWriteToStream(writeStream, JSON.stringify(item));
    // eslint-disable-next-line no-await-in-loop -- stream backpressure
    if (p) await p;
    if (i < len - 1) {
      p = asyncWriteToStream(writeStream, ',\n');
      // eslint-disable-next-line no-await-in-loop -- stream backpressure
      if (p) await p;
    }
  }
  p = asyncWriteToStream(writeStream, ']\n');
  if (p) await p;

  async function querySpeedtestApi(keyword: string) {
    const url = `https://www.speedtest.net/api/js/servers?engine=js&search=${keyword}&limit=100`;

    try {
      const randomUserAgent = topUserAgents[Math.floor(Math.random() * topUserAgents.length)];

      return await s.add<SpeedTestServer[]>(
        () => $$fetch(url, {
          headers: {
            dnt: '1',
            Referer: 'https://www.speedtest.net/',
            Accept: 'application/json, text/plain, */*',
            'User-Agent': randomUserAgent,
            'Accept-Language': 'en-US,en;q=0.9',
            ...(randomUserAgent.includes('Chrome')
              ? {
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Gpc': '1'
              }
              : {})
          },
          signal: AbortSignal.timeout(1000 * 60)
        }).then(res => res.json() as Promise<SpeedTestServer[]>)
      );
    } catch (e) {
      console.error(e);
      return [];
    }
  }
})();

function dedupeSpeedTestServersByUrl(servers: SpeedTestServer[]): SpeedTestServer[] {
  const seen = new Set<string>();
  return servers.filter(server => {
    if (seen.has(server.url)) {
      return false;
    }
    seen.add(server.url);
    return true;
  });
}
