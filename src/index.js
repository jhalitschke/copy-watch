import chokidar from 'chokidar';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Muster, die praktisch nie gespiegelt werden sollen.
 * Bewusst eng gehalten: pauschales Ignorieren aller Dotfiles würde
 * .htaccess, .env oder .well-known mit wegwerfen.
 */
export const DEFAULT_IGNORE = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/, // macOS Finder-Metadaten
  /(^|[\\/])\.Spotlight-V100([\\/]|$)/, // macOS Volume-Indizes
  /(^|[\\/])\.Trashes([\\/]|$)/,
  /(^|[\\/])\.fseventsd([\\/]|$)/,
  /(^|[\\/])\._[^\\/]+$/, // AppleDouble Resource-Forks auf FAT/exFAT/SMB
  /\.icloud$/, // iCloud-Platzhalter für ausgelagerte Dateien
  /\.sb-[a-z0-9]+$/i, // Atomic-Save-Verzeichnisse mancher macOS-Editoren
  /~$/, // vim/emacs Backups
  /\.swp$/,
  /\.tmp$/,
  /\.crdownload$/,
  /\.part$/,
  /^4913$/, // vim-Testdatei beim Speichern
];

/** Fehler, die bei Descriptor-Knappheit auftreten (macOS: ulimit -n 256 by default). */
const FD_ERRORS = new Set(['EMFILE', 'ENFILE']);

const noop = () => {};

/**
 * macOS und Windows vergleichen Pfade case-insensitiv; macOS liefert
 * Dateinamen je nach Volume in NFD oder NFC.
 */
function normalizePath(p) {
  const normalized = path.resolve(p).normalize('NFC');
  return process.platform === 'darwin' || process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

/**
 * Hängt einen Watcher an `src` und spiegelt jede geschriebene Datei nach `dest`.
 *
 * @param {object} options
 * @param {string} options.src                Quellordner (wird rekursiv beobachtet)
 * @param {string} options.dest               Zielordner
 * @param {boolean} [options.initial=false]   Beim Start den vorhandenen Bestand einmal kopieren
 * @param {boolean} [options.delete=false]    Gelöschte Quelldateien auch im Ziel entfernen
 * @param {boolean} [options.poll=false]      Polling statt Kernel-Events (SMB, Netzlaufwerke, VMs)
 * @param {number} [options.interval=500]     Polling-Intervall in ms
 * @param {number} [options.stability=300]    Wartezeit bis eine Datei als fertig geschrieben gilt
 * @param {number} [options.debounce=50]      Events pro Datei bündeln (ms)
 * @param {number} [options.deleteDelay=400]  Karenzzeit vor dem Löschen im Ziel (Atomic Saves)
 * @param {number} [options.retries=5]        Wiederholungen bei EMFILE/ENFILE
 * @param {Array<RegExp|string>} [options.ignore]  Zusätzliche Ignore-Muster
 * @param {boolean} [options.dryRun=false]    Nur melden, nichts schreiben
 * @param {(event: {type: string, from: string, to: string, rel: string}) => void} [options.onEvent]
 * @param {(err: Error) => void} [options.onError]
 * @returns {import('chokidar').FSWatcher}
 */
export function createCopyWatcher(options) {
  const {
    src,
    dest,
    initial = false,
    delete: deleteRemoved = false,
    poll = false,
    interval = 500,
    stability = 300,
    debounce = 50,
    deleteDelay = 400,
    retries = 5,
    ignore = [],
    dryRun = false,
    onEvent = noop,
    onError = noop,
  } = options;

  if (!src || !dest) {
    throw new Error('createCopyWatcher: "src" und "dest" sind erforderlich');
  }

  const srcRoot = path.resolve(src);
  const destRoot = path.resolve(dest);
  const srcKey = normalizePath(srcRoot);
  const destKey = normalizePath(destRoot);

  if (srcKey === destKey) {
    throw new Error('createCopyWatcher: "dest" darf nicht "src" sein');
  }
  if (destKey.startsWith(srcKey + path.sep)) {
    throw new Error(
      'createCopyWatcher: "dest" liegt innerhalb von "src" — das erzeugt eine Endlosschleife',
    );
  }

  const patterns = [...DEFAULT_IGNORE, ...ignore.map(toRegExp)];
  const target = (file) => path.join(destRoot, path.relative(srcRoot, file));

  const watcher = chokidar.watch(srcRoot, {
    ignoreInitial: !initial,
    usePolling: poll,
    interval,
    binaryInterval: interval,
    // Verhindert, dass halb geschriebene Dateien kopiert werden.
    awaitWriteFinish: {
      stabilityThreshold: stability,
      pollInterval: Math.min(100, interval),
    },
    ignored: (candidate) => {
      if (normalizePath(candidate) === srcKey) return false; // Wurzel nie ignorieren
      const rel = path.relative(srcRoot, candidate);
      const base = path.basename(candidate);
      return patterns.some((re) => re.test(base) || re.test(rel));
    },
  });

  // Mehrere change-Events pro Datei (typisch für Bundler) zu einem Vorgang bündeln.
  const copyTimers = new Map();
  // Verzögerte Löschungen, damit Atomic Saves (unlink + rename) nichts wegräumen.
  const deleteTimers = new Map();

  const schedule = (map, key, delay, fn) => {
    clearTimeout(map.get(key));
    if (delay <= 0) {
      map.delete(key);
      fn();
      return;
    }
    map.set(
      key,
      setTimeout(() => {
        map.delete(key);
        fn();
      }, delay),
    );
  };

  const run = (type, file, action) => {
    const to = target(file);
    const rel = path.relative(srcRoot, file) || path.basename(file);
    Promise.resolve(dryRun ? undefined : withRetry(() => action(to), retries))
      .then(() => onEvent({ type, from: file, to, rel }))
      .catch(onError);
  };

  const onWrite = (type) => (file) => {
    // Ein neu erscheinender Pfad annulliert eine noch offene Löschung.
    clearTimeout(deleteTimers.get(file));
    deleteTimers.delete(file);
    schedule(copyTimers, file, debounce, () =>
      run(type, file, (to) => copyFile(file, to, retries)),
    );
  };

  watcher
    .on('add', onWrite('copy'))
    .on('change', onWrite('update'))
    .on('addDir', (dir) => {
      clearTimeout(deleteTimers.get(dir));
      deleteTimers.delete(dir);
      run('mkdir', dir, (to) => mkdir(to, { recursive: true }));
    })
    .on('unlink', (file) => {
      if (!deleteRemoved) return;
      clearTimeout(copyTimers.get(file));
      copyTimers.delete(file);
      schedule(deleteTimers, file, deleteDelay, () =>
        run('delete', file, (to) => rm(to, { force: true })),
      );
    })
    .on('unlinkDir', (dir) => {
      if (!deleteRemoved) return;
      schedule(deleteTimers, dir, deleteDelay, () =>
        run('rmdir', dir, (to) => rm(to, { force: true, recursive: true })),
      );
    })
    .on('error', (err) => {
      if (FD_ERRORS.has(err?.code)) {
        err.message +=
          '\n  Zu wenige File-Descriptors. Im selben Shell-Fenster "ulimit -n 4096" setzen' +
          '\n  (braucht keine Admin-Rechte) oder mit --poll starten.';
      }
      onError(err);
    });

  const close = watcher.close.bind(watcher);
  watcher.close = () => {
    for (const t of copyTimers.values()) clearTimeout(t);
    for (const t of deleteTimers.values()) clearTimeout(t);
    copyTimers.clear();
    deleteTimers.clear();
    return close();
  };

  return watcher;
}

async function copyFile(from, to, retries) {
  await withRetry(() => mkdir(path.dirname(to), { recursive: true }), retries);
  await withRetry(() => cp(from, to, { force: true }), retries);
}

/** Bei Descriptor-Knappheit kurz warten statt hart abbrechen. */
async function withRetry(fn, retries = 5) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!FD_ERRORS.has(err?.code)) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

function toRegExp(value) {
  return value instanceof RegExp ? value : new RegExp(value);
}

export default createCopyWatcher;
