import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

async function fixture(t, extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musicplay-test-'));
  const musicDir = path.join(dir, 'music');
  await fs.mkdir(musicDir);
  await fs.copyFile(new URL('./fixtures/tone.mp3', import.meta.url), path.join(musicDir, 'song.mp3'));
  const options = { musicDir, dataDir: path.join(dir, 'data'), youtubeKey: '', ...extra };
  const app = await createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const get = (route, options) => fetch(url + route, options);
  const post = (route, body) => get(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { get, post, options };
}
test('MP3 scan reads tags and duration, audio supports seeking, and arbitrary files stay private', async t => {
  const { get } = await fixture(t);
  const { tracks, warnings } = await (await get('/api/library')).json();
  assert.equal(tracks.length, 1); assert.equal(warnings.length, 0);
  assert.equal(tracks[0].title, 'Prueba de audio'); assert.equal(tracks[0].artist, 'MusicPLay'); assert.ok(tracks[0].duration >= 2);
  assert.equal(tracks[0].file, undefined);
  const response = await get(`/api/audio/${tracks[0].id}`, { headers: { Range: 'bytes=0-99' } });
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal((await get('/api/audio/unknown')).status, 404);
  assert.equal((await get('/.env')).status, 404);
  assert.match(await (await get('/')).text(), /Tu música/);
});
test('playlists persist, deduplicate, support concurrent additions and protect favorites', async t => {
  const { get, post, options } = await fixture(t);
  const { tracks } = await (await get('/api/library')).json();
  const list = await (await post('/api/playlists', { name: 'Para viajar' })).json();
  await Promise.all([post(`/api/playlists/${list.id}/tracks`, tracks[0]), post(`/api/playlists/${list.id}/tracks`, tracks[0]), post('/api/playlists/favorites/tracks', tracks[0])]);
  let lists = await (await get('/api/playlists')).json();
  assert.equal(lists.find(l => l.id === list.id).tracks.length, 1);
  assert.equal(lists.find(l => l.id === 'favorites').tracks.length, 1);
  await createApp(options);
  lists = JSON.parse(await fs.readFile(path.join(options.dataDir, 'playlists.json'), 'utf8'));
  assert.equal(lists.find(l => l.id === list.id).name, 'Para viajar');
  assert.equal((await get('/api/playlists/favorites', { method: 'DELETE' })).status, 400);
  assert.equal((await post('/api/playlists', { name: ' ' })).status, 400);
  assert.equal((await post('/api/playlists/favorites/tracks', { id: '../secret', source: 'local' })).status, 400);
  await get(`/api/playlists/${list.id}/tracks/local/${tracks[0].id}`, { method: 'DELETE' });
  assert.equal((await (await get('/api/playlists')).json()).find(l => l.id === list.id).tracks.length, 0);
  assert.equal((await get(`/api/playlists/${list.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await get('/api/playlists', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{"name":"bad"}' })).status, 403);
});
test('missing YouTube key is explicit; search and lyrics adapters handle upstream results', async t => {
  const missing = await fixture(t);
  assert.equal((await missing.get('/api/search?q=music')).status, 503);
  const calls = [];
  const service = await fixture(t, { youtubeKey: 'test-only', fetch: async url => {
    calls.push(String(url));
    return new Response(JSON.stringify(String(url).includes('googleapis') ? { items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Song', channelTitle: 'Artist', thumbnails: {} } }] } : { lyrics: 'Test lyrics' }), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal((await (await service.get('/api/search?q=Song')).json()).tracks[0].source, 'youtube');
  assert.equal((await (await service.get('/api/lyrics?artist=Artist&title=Song')).json()).lyrics, 'Test lyrics');
  assert.ok(calls[0].includes('videoEmbeddable=true'));
  const failing = await fixture(t, { youtubeKey: 'test-only', fetch: async () => { throw new Error('offline'); } });
  assert.equal((await failing.get('/api/search?q=Song')).status, 502);
  assert.equal((await failing.get('/api/lyrics?artist=Artist&title=Song')).status, 502);
});
test('desktop settings can switch music folders and YouTube credentials without restarting', async t => {
  let musicDir = path.resolve('test/fixtures');
  let key = '';
  const service = await fixture(t, { getMusicDir: () => musicDir, getYoutubeKey: () => key, fetch: async () => new Response('{"items":[]}', { headers: {'Content-Type':'application/json'} }) });
  assert.equal((await (await service.get('/api/library')).json()).tracks.length, 1);
  musicDir = path.join(service.options.dataDir, 'missing');
  const empty = await (await service.get('/api/library')).json();
  assert.equal(empty.tracks.length, 0); assert.ok(empty.warnings.length > 0);
  assert.equal((await (await service.get('/api/config')).json()).youtubeEnabled, false);
  key = 'test-only';
  assert.equal((await (await service.get('/api/config')).json()).youtubeEnabled, true);
  assert.equal((await service.get('/api/search?q=Song')).status, 200);
});
