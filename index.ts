import fs from 'node:fs';
import { newQueue } from '@henrygd/queue';
import { $$fetch } from './_fetch-retry';
import path from 'node:path';
import { asyncWriteToStream } from 'foxts/async-write-to-stream';
import { pickOne } from 'foxts/pick-random';

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

const queue = newQueue(2);

const KEYWORDS = [
  'China',
  'China Telecom',
  'China Mobile',
  'China Unicom',
  'CERNET',
  'Beijing',
  'Shanghai',
  'Guangzhou',
  'Shenzhen',
  'Suzhou',
  'Hangzhou',
  'Chengdu',
  'Hong Kong',
  'Taiwan',
  'Taichung',
  'Japan',
  'Tokyo',
  'Osaka',
  'Singapore',
  'Korea',
  'Seoul',
  'Canada',
  'Toronto',
  'Vancouver',
  'Montreal',
  'Los Ang',
  'San Jose',
  'Seattle',
  'New York',
  'Dallas',
  'Miami',
  'Chicago',
  'Berlin',
  'Frankfurt',
  'London',
  'Manchester',
  'Paris',
  'Austria',
  'Amsterdam',
  'Moscow',
  'Petersburg',
  'Warsaw',
  'Spain',
  'India',
  'Delhi',
  'Australia',
  'Sydney',
  'Brazil',
  'Turkey'
];

const publicFolder = path.join(__dirname, 'public');

(async () => {
  fs.mkdirSync(publicFolder, { recursive: true });

  const topUserAgents = (await (await $$fetch('https://cdn.jsdelivr.net/npm/top-user-agents/src/desktop.json')).json()) as string[];

  const data = dedupeSpeedTestServersByUrl((await queue.all(KEYWORDS.map(keyword => () => querySpeedtestApi(keyword)))).flat());

  if (data.length === 0) {
    throw new Error('No servers found');
  }

  data.sort((a, b) => (
    a.country.localeCompare(b.country)
    || a.name.localeCompare(b.name)
    || a.host.localeCompare(b.host)
    || a.sponsor.localeCompare(b.sponsor)
    || a.url.localeCompare(b.url)
    || a.id.localeCompare(b.id)
    || a.https_functional - b.https_functional
  ));

  const writeSpeedtestServersJsonStream = fs.createWriteStream(path.join(publicFolder, 'servers.json'));
  let p = asyncWriteToStream(writeSpeedtestServersJsonStream, '[\n');
  if (p) await p;
  for (let i = 0, len = data.length; i < len; i++) {
    const item = data[i];
    p = asyncWriteToStream(writeSpeedtestServersJsonStream, JSON.stringify(item));
    // eslint-disable-next-line no-await-in-loop -- stream backpressure
    if (p) await p;
    if (i < len - 1) {
      p = asyncWriteToStream(writeSpeedtestServersJsonStream, ',\n');
      // eslint-disable-next-line no-await-in-loop -- stream backpressure
      if (p) await p;
    }
  }
  p = asyncWriteToStream(writeSpeedtestServersJsonStream, ']\n');
  if (p) await p;

  async function querySpeedtestApi(keyword: string) {
    const url = `https://www.speedtest.net/api/js/servers?engine=js&search=${keyword}&limit=100`;

    try {
      const randomUserAgent = pickOne(topUserAgents);

      return await $$fetch(url, {
        headers: {
          dnt: '1',
          Referer: 'https://www.speedtest.net/',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': randomUserAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          ...(randomUserAgent.includes('Chrome')
            ? {
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Gpc': '1'
            }
            : {})
        },
        signal: AbortSignal.timeout(1000 * 60)
      }).then(res => res.json() as Promise<SpeedTestServer[]>).then(data => {
        for (let i = 0, len = data.length; i < len; i++) {
          data[i].distance = 0;
        }
        return data;
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  try {
    const randomUserAgent = pickOne(topUserAgents);
    const librespeed = await (await $$fetch('https://librespeed.org/backend-servers/servers.php', {
      headers: {
        dnt: '1',
        Referer: 'https://librespeed.org/',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': randomUserAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        ...(randomUserAgent.includes('Chrome')
          ? {
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Gpc': '1'
          }
          : {})
      },
      signal: AbortSignal.timeout(1000 * 60)
    })).text();

    fs.writeFileSync(path.join(publicFolder, 'librespeed-servers.json'), librespeed, 'utf-8');
  } catch (e) {
    console.error(e);
    fs.writeFileSync(path.join(publicFolder, 'librespeed-servers.json'), JSON.stringify([]), 'utf-8');
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
