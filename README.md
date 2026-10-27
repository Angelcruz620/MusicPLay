# MusicPLay para Windows

Aplicación de escritorio para Windows 10/11 de 64 bits, construida con Electron. Se abre en su propia ventana y el instalador incluye el motor de ejecución: el usuario final no necesita Node.js ni abrir el navegador.

## Instalar y usar

También puedes abrir la versión portable `dist/MusicPLay 1.0.0.exe` directamente, sin instalación. Guarda las listas y ajustes en los mismos datos de usuario que la versión instalada. El ejecutable de Windows se puede generar en Linux, pero su ejecución debe comprobarse en Windows.

El instalador generado se llama `dist/MusicPLay-Setup-1.0.0.exe`. Ejecútalo, elige la carpeta de instalación y abre **MusicPLay** desde el escritorio o el menú Inicio.

La aplicación detecta la carpeta **Música** configurada en Windows (incluidas ubicaciones redirigidas). En **Ajustes → Elegir carpeta** puedes seleccionar otra. El escaneo incluye subcarpetas, se actualiza cada 30 segundos mientras la ventana está visible y puede ejecutarse con **Escanear música**. Se admiten MP3; `music-metadata` lee título, artista, álbum, duración y carátulas JPEG/PNG/WebP.

Los controles permiten reproducir, pausar, avanzar, retroceder, buscar una posición y ajustar el volumen. La cola se crea al seleccionar una canción. Los corazones guardan favoritos; **+** crea listas o añade canciones a ellas. En una playlist personalizada, **×** quita una canción.

Las listas se guardan en `playlists.json` dentro de la carpeta de datos del usuario de Electron (normalmente `%APPDATA%\musicplay`). Los ajustes se guardan junto a ellas en `settings.json`. No se necesita acceso de escritura a la carpeta de instalación. Haz copia de los datos para conservar tus listas. Mover un MP3 cambia su identificador; vuelve a añadirlo a tus listas.

## YouTube y letras

Activa **YouTube Data API v3** en Google Cloud y copia tu clave en **Ajustes → Clave de YouTube Data API**. Restringe la clave a esa API. Se guarda cifrada mediante `safeStorage` de Electron y la protección de la cuenta de Windows; no se muestra al recuperarla ni se entrega al código de la interfaz. Puedes eliminarla desde Ajustes. La música local funciona sin clave.

La búsqueda combina archivos locales con resultados de YouTube. Se utiliza el reproductor oficial de YouTube, visible durante la reproducción: no se extrae ni descarga audio. Algunos vídeos no permiten reproducción integrada o tienen restricciones regionales; la búsqueda consume cuota de Google. Si el inicio automático está bloqueado, pulsa Play.

El panel **Letra** consulta `api.lyrics.ovh` con artista y título. El servicio puede no encontrar canciones, especialmente cuando los datos de YouTube son nombres de canales o títulos con texto adicional.

## Desarrollar y generar el instalador

En Windows, instala Node.js 24 y ejecuta desde el repositorio:

```powershell
npm ci
npm test
npm start
```

Para generar el instalador:

```powershell
npm run dist:win -- --publish never
```

El resultado queda en `dist/`. También existe el workflow **Build Windows installer** en `.github/workflows/windows.yml`: se puede ejecutar manualmente en GitHub Actions o al subir una etiqueta `v*`. El instalador queda como artefacto descargable `MusicPLay-Windows-Installer`; el workflow no publica releases automáticamente.

El instalador no lleva certificado de firma de código configurado. Windows puede mostrar un aviso de editor desconocido. Para distribuirlo con una identidad de editor verificable hace falta configurar un certificado de firma.

`npm run dist:portable` genera el ejecutable portable. `npm run pack:win` genera solamente la carpeta de aplicación para Windows, sin instalador. `npm test` comprueba metadatos MP3, solicitudes parciales de audio, persistencia, concurrencia, favoritos y adaptadores externos con respuestas simuladas. La muestra `test/fixtures/tone.mp3` es un tono sintético de dos segundos.

## Arquitectura

Electron administra la ventana, la selección nativa de carpetas, los datos del usuario y el almacenamiento seguro de claves. La interfaz tiene aislamiento de contexto, sandbox y Node.js deshabilitado; el puente IPC expone únicamente tres operaciones de ajustes y verifica el origen de quien las invoca. El servicio de música integrado escucha en un puerto aleatorio de `127.0.0.1` y se cierra con la aplicación. Solo se ejecuta una instancia por usuario.

El modo web anterior se conserva para desarrollo con `npm run web`. Solo en ese modo se utilizan `.env`, `MUSIC_DIR`, `YOUTUBE_API_KEY` y `DATA_DIR`; la versión de escritorio se configura desde Ajustes.

Conectividad: búsqueda en `www.googleapis.com`; reproducción en YouTube, `i.ytimg.com` y dominios multimedia `*.googlevideo.com`; letras en `api.lyrics.ovh`. Google Fonts es opcional y hay fuentes locales de respaldo. La validación real de YouTube requiere una clave y conexión; las pruebas simuladas no certifican su disponibilidad.
