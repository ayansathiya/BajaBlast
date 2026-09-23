/**
 * The Mac app.
 *
 * Electron wraps the same server the Pi runs and points a fullscreen window at
 * it. Nothing here is duplicated logic — the server, the calendar, the phone
 * page and the updater are all the shared code. This file is the window and
 * the macOS-specific behaviour around it.
 *
 * Loaded only when Electron is present. `launch.cjs` starts the server
 * headless on the Pi and never touches this; `npm run mac` goes through
 * Electron, which loads this instead.
 */
const { app, BrowserWindow, globalShortcut, powerMonitor, powerSaveBlocker, shell } = require('electron');
const path = require('node:path');

let mainWindow = null;

const isDev = !!process.env.BAJA_DEV;
const PORT = 8787;

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: !isDev,
    kiosk: !isDev,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Turns on the <webview> element the in-app browser uses. Off by
      // default in Electron, and without it the Recipes screen's "Browse the
      // web" falls back to an iframe, which most recipe sites refuse.
      //
      // It's a real browser view with no Node access of its own: the page
      // inside gets contextIsolation and nodeIntegration off, same as this
      // window, so a site it loads can't reach the household's files.
      webviewTag: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Over HTTP, not from the filesystem.
  //
  // The Pi rewrite made the server serve the display, and loading it the same
  // way here means one code path instead of two. It also fixes something the
  // old file:// version couldn't do: the display is now reachable from any
  // other device on the network, not just this machine.
  mainWindow.loadURL(`http://localhost:${PORT}/`);

  // A blank kitchen display can't be diagnosed by whoever is standing in front
  // of it, so retry rather than sit on an error page. The usual cause is the
  // window being ready a beat before the server has bound its port.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[baja-blast] Window failed to load (${code} ${desc}) — retrying.`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`http://localhost:${PORT}/`);
    }, 2000);
  });

  // Links to anything that isn't the app open in the real browser. Otherwise a
  // stray click strands the kiosk on a web page with no address bar and no way
  // back, on a machine with no keyboard.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Belt to the braces above: whatever the page asks for when it attaches a
  // <webview>, it gets a sandboxed one. The renderer is our own code, but this
  // is the boundary between the household's machine and the open web, and it
  // costs three lines to make it not depend on the renderer behaving.
  mainWindow.webContents.on('will-attach-webview', (_e, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  mainWindow.on('close', (e) => {
    if (!isDev && !app.isQuitting) e.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Block plain Cmd+Q. The deliberate exit is Cmd+Shift+Q below.
    if ((input.meta || input.control) && input.key.toLowerCase() === 'q' && !input.shift) {
      event.preventDefault();
    }
  });

  return mainWindow;
}

function start({ payload }) {
  app.whenReady().then(() => {
    const { startServer } = require(path.join(payload.root, 'app', 'server.cjs'));

    startServer({
      payload,
      relaunch: () => {
        app.isQuitting = true;
        app.relaunch();
        app.exit(0);
      },
    });

    createWindow();

    // Hard to hit by accident, which is the point.
    globalShortcut.register('CommandOrControl+Shift+Q', () => {
      app.isQuitting = true;
      app.quit();
    });

    if (!isDev) powerSaveBlocker.start('prevent-display-sleep');

    // Coming back from sleep, the renderer's timers resume mid-flight and
    // Wi-Fi usually isn't up yet, so the first round of fetches fails. The
    // live stream reconnects on its own — this is the belt to that braces.
    powerMonitor.on('resume', () => {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      }, 20_000);
    });

    // A renderer crash on a wall display is a black screen nobody is there to
    // dismiss. Bring it back.
    app.on('render-process-gone', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
}

module.exports = { start };
