const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let mainWindow, server, origin, settingsFile;
let settings = {};
let youtubeKey = '';

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(boot).catch(error => { console.error(error.message); dialog.showErrorBox('MusicPLay', 'No se pudo iniciar la aplicación. Comprueba los permisos de la carpeta de datos.'); app.quit(); });
}
function trusted(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('Origen no permitido');
}
function publicSettings() { return { musicDir: settings.musicDir || app.getPath('music'), youtubeEnabled: Boolean(youtubeKey), canSaveKey: safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text' }; }
async function save(next) {
  const temp = settingsFile + '.tmp';
  await fs.writeFile(temp, JSON.stringify(next, null, 2));
  await fs.rename(temp, settingsFile);
  settings = next;
}
async function boot() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  try { settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (settings.youtubeKey && safeStorage.isEncryptionAvailable()) {
    try { youtubeKey = safeStorage.decryptString(Buffer.from(settings.youtubeKey, 'base64')); } catch { dialog.showErrorBox('Clave de YouTube', 'No se pudo recuperar la clave guardada. Vuelve a introducirla en Ajustes.'); }
  }
  const { createApp } = await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);
  const backend = await createApp({ dataDir: app.getPath('userData'), getMusicDir: () => settings.musicDir || app.getPath('music'), getYoutubeKey: () => youtubeKey });
  server = backend.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  origin = `http://127.0.0.1:${server.address().port}`;
  ipcMain.handle('settings:get', event => { trusted(event); return publicSettings(); });
  ipcMain.handle('settings:music', async event => {
    trusted(event);
    const selected = await dialog.showOpenDialog(mainWindow, { title: 'Selecciona tu carpeta de música', defaultPath: publicSettings().musicDir, properties: ['openDirectory'] });
    if (!selected.canceled && selected.filePaths[0]) await save({ ...settings, musicDir: selected.filePaths[0] });
    return publicSettings();
  });
  ipcMain.handle('settings:youtube', async (event, value) => {
    trusted(event);
    if (typeof value !== 'string' || value.length > 256) throw new Error('Clave inválida');
    value = value.trim();
    if (value && !publicSettings().canSaveKey) throw new Error('El almacenamiento seguro del sistema no está disponible.');
    const next = { ...settings };
    if (value) next.youtubeKey = safeStorage.encryptString(value).toString('base64'); else delete next.youtubeKey;
    await save(next); youtubeKey = value;
    return publicSettings();
  });
  mainWindow = new BrowserWindow({ width: 1280, height: 860, minWidth: 390, minHeight: 600, title: 'MusicPLay', backgroundColor: '#080d10', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadURL(origin);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { server?.closeAllConnections(); server?.close(); });
