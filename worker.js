const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

async function getVqd(q) {
  const r = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=images&iax=images`, { headers: HEADERS });
  if (!r.ok) return null;
  const html = await r.text();
  const patterns = [
    /vqd=["']([^"']+)["']/,
    /"vqd":"([^"]+)"/,
    /vqd=([\d-]+)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

async function searchDDG(q) {
  const vqd = await getVqd(q);
  if (!vqd) return [];
  const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${encodeURIComponent(vqd)}&p=-1&f=,,,&v7exp=a`;
  const r = await fetch(apiUrl, { headers: { ...HEADERS, 'Referer': 'https://duckduckgo.com/' } });
  if (!r.ok) return [];
  const data = await r.json();
  return data.results || [];
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const skip = parseInt(url.searchParams.get('skip') || '0', 10);
    const mode = url.searchParams.get('mode') || 'image';

    if (!q) return json({ error: 'missing q parameter' }, 400);

    let results;
    try {
      results = await searchDDG(q);
    } catch (e) {
      return json({ error: 'search failed', detail: e.message }, 502);
    }
    if (!results.length) return json({ error: 'no results' }, 404);

    if (mode === 'list') {
      return json({
        count: results.length,
        results: results.slice(0, 10).map(r => ({
          image: r.image,
          thumbnail: r.thumbnail,
          title: r.title,
          source: r.source,
          url: r.url,
          width: r.width,
          height: r.height,
        })),
      });
    }

    for (let i = skip; i < Math.min(skip + 3, results.length); i++) {
      const imgUrl = results[i].image;
      if (!imgUrl) continue;
      try {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 4000);
        const imgResp = await fetch(imgUrl, {
          headers: { 'User-Agent': HEADERS['User-Agent'], 'Referer': 'https://duckduckgo.com/' },
          cf: { cacheTtl: 3600 },
          signal: ctl.signal,
        });
        clearTimeout(tm);
        if (!imgResp.ok) continue;
        const ct = imgResp.headers.get('content-type') || '';
        if (!ct.startsWith('image/')) continue;
        return new Response(imgResp.body, {
          headers: {
            'Content-Type': ct,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
            'X-Source-Url': imgUrl.slice(0, 500),
            'X-Result-Index': String(i),
          },
        });
      } catch {}
    }
    return json({ error: 'all candidates failed' }, 502);
  },
};
