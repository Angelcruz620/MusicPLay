const $ = s => document.querySelector(s);
const audio = $('#audio');
let local = [], online = [], lists = [], view = 'all', filter = 'all', query = '', current = null, queue = [], index = -1;
let youtubeEnabled = false, yt, ytPromise, searchVersion = 0, playVersion = 0, lyricsVersion = 0;
const same = (a, b) => a?.id === b?.id && a?.source === b?.source;
const time = n => { n = Number.isFinite(n) ? Math.max(0, n) : 0; return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`; };
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
async function api(url, options) { const r = await fetch(url, options); if (r.status === 204) return; const data = await r.json(); if (!r.ok) throw new Error(data.error || 'No se pudo completar la operación.'); return data; }
const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
const liked = t => lists.find(l => l.id === 'favorites')?.tracks.some(v => same(v, t));
function cover(container, track) { container.replaceChildren(); if (track?.cover) { const img = el('img'); img.src = track.cover; img.alt = ''; img.loading = 'lazy'; img.onerror = () => container.replaceChildren(document.createTextNode('♫')); container.append(img); } else container.textContent = '♫'; }
function visible() { const base = view === 'all' ? [...local, ...online] : view === 'local' ? local : lists.find(l => l.id === view)?.tracks || []; return base.filter(t => (filter === 'all' || t.source === filter) && (!query || `${t.title} ${t.artist}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || t.source === 'youtube' && view === 'all')); }
function render() {
  const tracks = visible();
  $('#tracks').replaceChildren();
  $('#track-count').textContent = `${tracks.length} canciones`;
  $('#empty').hidden = tracks.length > 0;
  $('#empty h3').textContent = query ? 'No encontramos ese sonido' : view === 'all' || view === 'local' ? 'El comienzo de tu soundtrack' : 'Dale vida a esta playlist';
  $('#empty p').textContent = query ? 'Prueba con otro título o artista. La búsqueda local funciona aunque YouTube no esté configurado.' : view === 'all' || view === 'local' ? (window.musicplayDesktop ? 'Tu carpeta Música se detecta automáticamente. Puedes elegir otra carpeta en Ajustes o buscar canciones en YouTube.' : 'Añade archivos MP3 a la carpeta de música del servidor y pulsa Escanear música. También puedes buscar canciones en YouTube.') : 'Usa el corazón o el botón + de una canción para guardarla aquí.';
  for (const t of tracks) {
    const card = el('article', 'track'), art = el('div', 'track-art'); cover(art, t);
    const play = el('button', 'card-play', same(current, t) ? '♫' : '▶︎'); play.ariaLabel = `Reproducir ${t.title}`; play.onclick = () => start(t, tracks);
    // Image error fallback must retain the play button.
    const img = art.querySelector('img'); if (img) img.onerror = () => { img.remove(); art.prepend(document.createTextNode('♫')); };
    art.append(play); const title = el('h3', '', t.title); title.title = t.title;
    const actions = el('div', 'track-actions'); actions.append(el('span', 'source', t.source === 'local' ? '↳ Local' : 'YouTube'));
    const heart = el('button', liked(t) ? 'liked' : '', liked(t) ? '♥' : '♡'); heart.ariaLabel = `${liked(t) ? 'Quitar de' : 'Añadir a'} favoritos: ${t.title}`; heart.onclick = () => toggleFavorite(t);
    const add = el('button', '', '+'); add.ariaLabel = `Añadir ${t.title} a una playlist`; add.onclick = () => addDialog(t);
    actions.append(heart, add);
    if (!['all', 'local', 'favorites'].includes(view)) { const remove = el('button', '', '×'); remove.ariaLabel = `Quitar ${t.title} de la playlist`; remove.onclick = async () => { try { await api(`/api/playlists/${view}/tracks/${t.source}/${t.id}`, { method: 'DELETE' }); await loadLists(); } catch(e) { toast(e.message); } }; actions.append(remove); }
    card.append(art, title, el('p', '', t.artist), actions); $('#tracks').append(card);
  }
  $('#current-favorite').textContent = current && liked(current) ? '♥' : '♡';
  $('#current-favorite').classList.toggle('liked', Boolean(current && liked(current)));
  $('#current-favorite').ariaLabel = current && liked(current) ? 'Quitar de favoritos' : 'Añadir a favoritos';
}
async function loadLists() { lists = await api('/api/playlists'); renderNav(); render(); }
function renderNav() {
  $('#playlist-nav').replaceChildren();
  const create = el('button', 'playlist-link mobile-new', '+ Nueva playlist'); create.style.display = 'none'; create.onclick = () => $('#list-dialog').showModal(); $('#playlist-nav').append(create);
  for (const list of lists.filter(l => l.id !== 'favorites')) { const b = el('button', `playlist-link ${view === list.id ? 'active' : ''}`, `♫  ${list.name}`); b.onclick = () => setView(list.id); $('#playlist-nav').append(b); }
}
function setView(next) { view = next; query = ''; $('#search').value = ''; online = []; searchVersion++; filter = 'all'; document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view)); document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter)); const title = view === 'all' ? 'Explora tu música' : view === 'local' ? 'Mi biblioteca' : lists.find(l => l.id === view)?.name || 'Playlist'; $('#section-title').textContent = title; $('#breadcrumb').textContent = view === 'all' ? 'Descubrir' : title; $('#notice').textContent = ''; renderNav(); render(); }
async function toggleFavorite(t) { try { if (liked(t)) await api(`/api/playlists/favorites/tracks/${t.source}/${t.id}`, { method: 'DELETE' }); else await post('/api/playlists/favorites/tracks', t); await loadLists(); } catch(e) { toast(e.message); } }
function addDialog(t) { $('#add-options').replaceChildren(); for (const list of lists) { const b = el('button', '', list.name); b.onclick = async () => { try { await post(`/api/playlists/${list.id}/tracks`, t); await loadLists(); $('#add-dialog').close(); toast(`Guardada en ${list.name}`); } catch(e) { toast(e.message); } }; $('#add-options').append(b); } $('#add-dialog').showModal(); }
async function scan() { $('#scan').disabled = true; $('#scan').textContent = 'Escaneando…'; try { const data = await api('/api/library'); local = data.tracks; $('#notice').textContent = data.warnings.join(' · '); render(); } catch(e) { toast(e.message); } finally { $('#scan').disabled = false; $('#scan').textContent = '↻ Escanear música'; } }
function youtube() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No se pudo cargar el reproductor de YouTube. Comprueba tu conexión.')), 15000);
    window.onYouTubeIframeAPIReady = () => { yt = new window.YT.Player('youtube-player', { width: 320, height: 200, playerVars: { playsinline: 1, origin: location.origin }, events: { onReady: () => { clearTimeout(timeout); yt.setVolume(Number($('#volume').value)); resolve(yt); }, onStateChange: e => { if (current?.source !== 'youtube') return; playing(e.data === 1); if (e.data === 0) step(1); }, onError: () => { playing(false); toast('Este vídeo no se puede reproducir aquí. Selecciona otra canción.'); } } }); };
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => { clearTimeout(timeout); reject(new Error('No se pudo cargar YouTube.')); }; document.head.append(script);
  });
  return ytPromise;
}
function playing(value) { $('#play').textContent = value ? 'Ⅱ' : '▶︎'; $('#play').ariaLabel = value ? 'Pausar' : 'Reproducir'; }
async function start(t, tracks) {
  const version = ++playVersion;
  audio.pause(); yt?.pauseVideo?.(); current = t; queue = [...tracks]; index = queue.findIndex(v => same(v, t));
  $('#current-title').textContent = t.title; $('#current-artist').textContent = t.artist; cover($('#current-cover'), t);
  for (const id of ['play', 'previous', 'next', 'progress', 'current-favorite']) $(`#${id}`).disabled = false;
  $('#youtube-shell').hidden = t.source !== 'youtube'; $('#progress').value = 0; $('#elapsed').textContent = '0:00'; $('#duration').textContent = time(t.duration); playing(false); render();
  if (!$('#lyrics-panel').hidden) showLyrics();
  try { if (t.source === 'local') { audio.src = `/api/audio/${t.id}`; audio.volume = Number($('#volume').value) / 100; await audio.play(); } else { const player = await youtube(); if (version !== playVersion) return; player.loadVideoById(t.id); } } catch(e) { if (version === playVersion) toast(e.message); }
}
function step(delta) { if (!queue.length) return; const next = index + delta; if (next < 0 || next >= queue.length) { if (delta > 0) { audio.pause(); yt?.pauseVideo?.(); playing(false); } return; } start(queue[next], queue); }
audio.onplay = () => { if (current?.source === 'local') playing(true); }; audio.onpause = () => { if (current?.source === 'local') playing(false); }; audio.onended = () => step(1); audio.onerror = () => { if (current?.source === 'local') toast('No se pudo reproducir el MP3. Comprueba que el archivo sigue disponible.'); };
$('#play').onclick = async () => { if (!current) return; if (current.source === 'youtube') { try { const p = await youtube(); p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(); } catch(e) { toast(e.message); } } else if (audio.paused) { try { await audio.play(); } catch(e) { toast(e.message); } } else audio.pause(); };
$('#previous').onclick = () => step(-1); $('#next').onclick = () => step(1);
let seeking = false;
$('#progress').oninput = () => { seeking = true; };
$('#progress').onchange = () => { const duration = current?.source === 'youtube' ? yt?.getDuration?.() : audio.duration; if (Number.isFinite(duration)) { const position = Number($('#progress').value) * duration / 100; current?.source === 'youtube' ? yt?.seekTo(position, true) : audio.currentTime = position; } seeking = false; };
setInterval(() => { if (!current) return; const duration = current.source === 'youtube' ? yt?.getDuration?.() : audio.duration; const position = current.source === 'youtube' ? yt?.getCurrentTime?.() : audio.currentTime; $('#elapsed').textContent = time(position); $('#duration').textContent = time(duration); if (!seeking) $('#progress').value = duration > 0 ? position / duration * 100 : 0; }, 500);
$('#volume').oninput = () => { audio.volume = Number($('#volume').value) / 100; yt?.setVolume?.(Number($('#volume').value)); };
async function showLyrics() { $('#lyrics-panel').hidden = false; const version = ++lyricsVersion; $('#lyrics-song').textContent = current ? `${current.title} · ${current.artist}` : ''; $('#lyrics-text').textContent = current ? 'Buscando la letra…' : 'Selecciona una canción para ver su letra.'; if (!current) return; try { const data = await api(`/api/lyrics?${new URLSearchParams({ title: current.title, artist: current.artist })}`); if (version === lyricsVersion) $('#lyrics-text').textContent = data.lyrics; } catch(e) { if (version === lyricsVersion) $('#lyrics-text').textContent = e.message; } }
$('#lyrics-button').onclick = showLyrics; $('#close-lyrics').onclick = () => { $('#lyrics-panel').hidden = true; lyricsVersion++; };
$('#current-favorite').onclick = () => current && toggleFavorite(current);
$('#hero-play').onclick = () => { const tracks = visible(); if (tracks.length) start(tracks[0], tracks); else toast('Añade MP3 a tu biblioteca o busca una canción en YouTube.'); };
$('#scan').onclick = scan;
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(c => c.classList.toggle('active', c === b)); render(); });
$('#search-form').onsubmit = async e => { e.preventDefault(); query = $('#search').value.trim(); online = []; const version = ++searchVersion; render(); if (view !== 'all' || !query) return; if (!youtubeEnabled) { $('#notice').textContent = (window.musicplayDesktop ? 'Búsqueda local activa. Añade tu clave de YouTube en Ajustes para buscar en línea.' : 'Búsqueda local activa. Configura YOUTUBE_API_KEY en el servidor para incluir resultados de YouTube.'); return; } $('#notice').textContent = 'Buscando en YouTube…'; try { const result = await api(`/api/search?q=${encodeURIComponent(query)}`); if (version !== searchVersion) return; online = result.tracks; $('#notice').textContent = ''; render(); } catch(e) { if (version === searchVersion) $('#notice').textContent = e.message; } };
$('#new-list').onclick = () => $('#list-dialog').showModal(); $('#cancel-list').onclick = () => $('#list-dialog').close(); $('#cancel-add').onclick = () => $('#add-dialog').close();
$('#list-form').onsubmit = async e => { e.preventDefault(); const button = e.submitter; button.disabled = true; try { const list = await post('/api/playlists', { name: $('#list-name').value }); await loadLists(); $('#list-dialog').close(); $('#list-name').value = ''; setView(list.id); toast('Playlist creada. Añade canciones desde Descubrir.'); } catch(e) { toast(e.message); } finally { button.disabled = false; } };
async function init() { try { const config = await api('/api/config'); youtubeEnabled = config.youtubeEnabled; await loadLists(); await scan(); } catch(e) { toast(e.message); } }
init();
// Detect newly downloaded MP3s while the application is open.
setInterval(async () => { if (document.hidden) return; try { const result = await api('/api/library'); if (JSON.stringify(local) !== JSON.stringify(result.tracks)) { local = result.tracks; render(); } } catch { /* The manual scan provides an actionable error. */ } }, 30000);

if (window.musicplayDesktop) {
  const desktop = window.musicplayDesktop;
  $('#desktop-settings').hidden = false;
  function showSettings(settings) {
    $('#music-folder').textContent = settings.musicDir;
    $('#youtube-key-status').textContent = settings.youtubeEnabled ? 'Clave configurada' : 'Sin clave configurada';
    youtubeEnabled = settings.youtubeEnabled;
  }
  $('#desktop-settings').onclick = async () => {
    try { showSettings(await desktop.getSettings()); $('#settings-dialog').showModal(); } catch (e) { toast(e.message); }
  };
  $('#choose-folder').onclick = async () => {
    try { showSettings(await desktop.chooseMusicFolder()); await scan(); } catch (e) { toast(e.message); }
  };
  $('#youtube-key-form').onsubmit = async e => {
    e.preventDefault();
    if (!$('#youtube-key').value.trim()) { toast('Introduce una clave o utiliza Eliminar clave.'); return; }
    e.submitter.disabled = true;
    try { showSettings(await desktop.setYoutubeKey($('#youtube-key').value)); $('#youtube-key').value = ''; toast('Clave guardada de forma segura.'); } catch (e) { toast(e.message); }
    finally { e.submitter.disabled = false; }
  };
  $('#remove-key').onclick = async () => {
    try { showSettings(await desktop.setYoutubeKey('')); $('#youtube-key').value = ''; toast('Clave eliminada.'); } catch (e) { toast(e.message); }
  };
  $('#close-settings').onclick = () => { $('#youtube-key').value = ''; $('#settings-dialog').close(); };
}
