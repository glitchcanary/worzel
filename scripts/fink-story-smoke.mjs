import WebSocket from 'ws';
// Fink story smoke test: start every story in GET /api/stories over the
// WebSocket and report narration, choices and the first picture's HTTP status.
// Usage: node scripts/fink-story-smoke.mjs [http://localhost:3001]
// (for the unified server use http://localhost:3000/fink)
const base = (process.argv[2] ?? 'http://localhost:3001').replace(/\/$/, '');
const { stories } = await (await fetch(base + '/api/stories')).json();
const ota = await (await fetch(base + '/api/ota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_id: 'smoke-1' }) })).json();
const ws = new WebSocket(ota.server_url + '?token=' + encodeURIComponent(ota.token) + '&story=menu');
const waitFor = (pred, ms = 25000) => new Promise((res) => {
  const t = setTimeout(() => { ws.off('message', h); res(null); }, ms);
  const h = (data, isBin) => { if (isBin) return; const m = JSON.parse(data.toString()); if (pred(m)) { clearTimeout(t); ws.off('message', h); res(m); } };
  ws.on('message', h);
});
await new Promise(r => ws.on('open', r));
ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', audio_params: { format: 'pcm', sample_rate: 16000, channels: 1, frame_duration: 60 }, features: [] }));
console.log('menu:', (await waitFor(m => m.type === 'ink_state'))?.storyId);
for (const s of stories) {
  ws.send(JSON.stringify({ type: 'fink_start', story_id: s.id }));
  const m = await waitFor(m => (m.type === 'ink_state' && m.restarted) || (m.type === 'error' && m.code === 'STORY_UNAVAILABLE'));
  if (!m || m.type === 'error') { console.log('FAIL', s.id, m?.message ?? 'timeout'); continue; }
  const imgs = m.narration.filter(n => n.image).map(n => n.image);
  let imgStatus = '';
  if (imgs[0]) {
    const u = imgs[0].startsWith('http') ? imgs[0] : base + '/' + imgs[0];
    imgStatus = (await fetch(u, { method: 'HEAD' }).catch(() => ({ status: 'ERR' }))).status;
  }
  console.log('OK  ', s.id.padEnd(28), 'narr', m.narration.length, 'choices', m.choices.length, imgs[0] ? `img ${imgStatus} ${imgs[0].slice(0, 90)}` : '');
}
ws.close();
process.exit(0);
