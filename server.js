import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
const favorite = () => ({ id: 'favorites', name: 'Favoritos', tracks: [] });
export async function createApp(options = {}) {
  const app = express();
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(root, '.data');
  const defaultMusicDir = path.resolve(options.musicDir || process.env.MUSIC_DIR || path.join(os.homedir(), await fs.access(path.join(os.homedir(), 'Music')).then(() => 'Music').catch(() => 'Música')));
  const getKey = () => options.getYoutubeKey ? options.getYoutubeKey() : options.youtubeKey ?? process.env.YOUTUBE_API_KEY;
  const request = options.fetch || fetch;
  const library = new Map();
  let scanPromise;
  let storageQueue = Promise.resolve();
  await fs.mkdir(dataDir, { recursive: true });
  const storeFile = path.join(dataDir, 'playlists.json');
  try { await fs.writeFile(storeFile, JSON.stringify([favorite()]), { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const readLists = async () => JSON.parse(await fs.readFile(storeFile, 'utf8'));
  const mutate = fn => {
    const work = storageQueue.then(async () => {
      const lists = await readLists();
      const result = fn(lists);
      const temp = `${storeFile}.tmp`;
      await fs.writeFile(temp, JSON.stringify(lists, null, 2));
      await fs.rename(temp, storeFile);
      return result;
    });
    storageQueue = work.catch(() => {});
    return work;
  };
  async function scan() {
    if (scanPromise) return scanPromise;
    scanPromise = (async () => {
      const next = new Map();
      const warnings = [];
      async function walk(dir) {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch { warnings.push('No se pudo leer una carpeta de música. Comprueba MUSIC_DIR y los permisos.'); return; }
        for (const entry of entries) {
          const file = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(file);
          else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
            try {
              const metadata = await parseFile(file);
              const id = hash(file);
              const picture = metadata.common.picture?.find(p => ['image/jpeg', 'image/png', 'image/webp'].includes(p.format));
              next.set(id, { file, picture, track: { id, source: 'local', title: metadata.common.title || path.basename(file, path.extname(file)), artist: metadata.common.artist || 'Artista desconocido', album: metadata.common.album || 'Biblioteca local', duration: metadata.format.duration || 0, cover: picture ? `/api/cover/${id}` : null } });
            } catch { warnings.push(`No se pudo leer ${entry.name}`); }
          }
        }
      }
      await walk(options.getMusicDir ? options.getMusicDir() : defaultMusicDir);
      library.clear();
      for (const [id, value] of next) library.set(id, value);
      return { tracks: [...library.values()].map(v => v.track), warnings };
    })();
    try { return await scanPromise; } finally { scanPromise = null; }
  }
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Mutations are same-origin only; this server is intended for a private machine.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error: 'Origen no permitido' });
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/config', (req, res) => res.json({ youtubeEnabled: Boolean(getKey()) }));
  app.get('/api/library', async (req, res) => res.json(await scan()));
  app.get('/api/audio/:id', (req, res) => {
    const item = library.get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Archivo no disponible. Vuelve a escanear la biblioteca.' });
    res.type('audio/mpeg').sendFile(item.file);
  });
  app.get('/api/cover/:id', (req, res) => {
    const pic = library.get(req.params.id)?.picture;
    if (!pic) return res.sendStatus(404);
    res.type(pic.format).send(Buffer.from(pic.data));
  });
  app.get('/api/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 200);
    if (!q) return res.json({ tracks: [] });
    const key = getKey();
    if (!key) return res.status(503).json({ error: 'Configura YOUTUBE_API_KEY en .env para buscar en YouTube.' });
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', videoEmbeddable: 'true', maxResults: '20', q, key });
    let result;
    try { result = await request(url, { signal: AbortSignal.timeout(10000) }); } catch { return res.status(502).json({ error: 'No se pudo conectar con YouTube.' }); }
    if (!result.ok) return res.status(502).json({ error: 'YouTube no respondió correctamente. Revisa la clave, su cuota y sus restricciones.' });
    const data = await result.json();
    res.json({ tracks: (data.items || []).filter(i => /^[\w-]{11}$/.test(i.id?.videoId)).map(i => ({ id: i.id.videoId, source: 'youtube', title: i.snippet.title, artist: i.snippet.channelTitle, cover: i.snippet.thumbnails?.medium?.url, duration: 0 })) });
  });
  app.get('/api/lyrics', async (req, res) => {
    const artist = String(req.query.artist || '').trim().slice(0, 200);
    const title = String(req.query.title || '').trim().slice(0, 200);
    if (!artist || !title) return res.status(400).json({ error: 'Faltan artista y título.' });
    try {
      const response = await request(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return res.status(response.status === 404 ? 404 : 502).json({ error: 'No se encontró la letra o el servicio no está disponible.' });
      const data = await response.json();
      res.json({ lyrics: data.lyrics || 'Letra no disponible.' });
    } catch { res.status(502).json({ error: 'El servicio de letras no está disponible en este momento.' }); }
  });
  app.get('/api/playlists', async (req, res) => res.json(await readLists()));
  app.post('/api/playlists', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    if (!name) return res.status(400).json({ error: 'Escribe un nombre para la lista.' });
    res.status(201).json(await mutate(lists => { const list = { id: crypto.randomUUID(), name, tracks: [] }; lists.push(list); return list; }));
  });
  app.post('/api/playlists/:id/tracks', async (req, res) => {
    const t = req.body;
    if (!t || !['local', 'youtube'].includes(t.source) || typeof t.id !== 'string' || !(t.source === 'local' ? /^[a-f0-9]{24}$/ : /^[\w-]{11}$/).test(t.id) || typeof t.title !== 'string' || typeof t.artist !== 'string') return res.status(400).json({ error: 'Canción inválida.' });
    const track = t.source === 'local' ? library.get(t.id)?.track : { id: t.id, source: 'youtube', title: t.title.slice(0, 300), artist: t.artist.slice(0, 200), cover: `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`, duration: 0 };
    if (!track) return res.status(404).json({ error: 'Archivo local no disponible.' });
    const result = await mutate(lists => { const list = lists.find(l => l.id === req.params.id); if (!list) return null; if (!list.tracks.some(v => v.id === track.id && v.source === track.source)) list.tracks.push(track); return list; });
    res.status(result ? 200 : 404).json(result || { error: 'Lista no encontrada.' });
  });
  app.delete('/api/playlists/:id/tracks/:source/:trackId', async (req, res) => {
    const result = await mutate(lists => { const list = lists.find(l => l.id === req.params.id); if (!list) return null; list.tracks = list.tracks.filter(t => t.id !== req.params.trackId || t.source !== req.params.source); return list; });
    res.status(result ? 200 : 404).json(result || { error: 'Lista no encontrada.' });
  });
  app.delete('/api/playlists/:id', async (req, res) => {
    if (req.params.id === 'favorites') return res.status(400).json({ error: 'Favoritos es una lista permanente.' });
    const removed = await mutate(lists => { const i = lists.findIndex(l => l.id === req.params.id); if (i < 0) return false; lists.splice(i, 1); return true; });
    res.status(removed ? 204 : 404).end();
  });
  app.use(express.static(path.join(root, 'public')));
  app.use((err, req, res, next) => { console.error('Request failed:', err.code || err.name); res.status(err.status === 400 ? 400 : 500).json({ error: 'No se pudo completar la operación.' }); });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('MusicPLay iniciado en puerto', process.env.PORT || 3000));
}
