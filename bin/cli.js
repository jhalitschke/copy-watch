#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createCopyWatcher } from '../src/index.js';

const HELP = `
copy-watch — beobachtet einen Ordner und spiegelt geschriebene Dateien ins Ziel

  Aufruf:
    copy-watch <quelle> <ziel> [optionen]

  Optionen:
    -i, --initial            Bestand beim Start einmal kopieren
    -d, --delete             Geloeschte Quelldateien auch im Ziel entfernen
    -p, --poll               Polling statt Kernel-Events (SMB, Netzlaufwerke, VMs)
        --interval <ms>      Polling-Intervall (Default: 500)
        --stability <ms>     Wartezeit bis eine Datei als fertig gilt (Default: 300)
        --debounce <ms>      Events pro Datei buendeln (Default: 50)
        --delete-delay <ms>  Karenzzeit vor dem Loeschen im Ziel (Default: 400)
        --retries <n>        Wiederholungen bei EMFILE/ENFILE (Default: 5)
        --ignore <regex>     Zusaetzliches Ignore-Muster, mehrfach verwendbar
        --dry-run            Nur ausgeben, was passieren wuerde
    -q, --quiet              Keine Ausgabe pro Datei
    -h, --help               Diese Hilfe

  Beispiele:
    copy-watch ./dist ~/Sites/preview --initial --delete
    copy-watch ./src /Volumes/share --poll --interval 1000
    copy-watch ./build ./deploy --ignore '\\.map$' --ignore '^stats\\.json$'
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      initial: { type: 'boolean', short: 'i', default: false },
      delete: { type: 'boolean', short: 'd', default: false },
      poll: { type: 'boolean', short: 'p', default: false },
      interval: { type: 'string', default: '500' },
      stability: { type: 'string', default: '300' },
      debounce: { type: 'string', default: '50' },
      'delete-delay': { type: 'string', default: '400' },
      retries: { type: 'string', default: '5' },
      ignore: { type: 'string', multiple: true, default: [] },
      'dry-run': { type: 'boolean', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (err) {
  console.error(`Fehler: ${err.message}`);
  console.error(HELP);
  process.exit(1);
}

const { values, positionals } = parsed;

if (values.help || positionals.length < 2) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const [src, dest] = positionals;

const num = (raw, name) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Fehler: --${name} muss eine nicht-negative Zahl sein (bekommen: ${raw})`);
    process.exit(1);
  }
  return n;
};

/**
 * macOS startet Shells mit einem Soft-Limit von 256 Descriptors.
 * Chokidar oeffnet pro Verzeichnis einen Watch — bei tiefen Baeumen wird das eng.
 * Das Soft-Limit laesst sich bis zum Hard-Limit ohne Admin-Rechte anheben.
 */
function checkDescriptorLimit() {
  if (process.platform !== 'darwin' || values.poll || values.quiet) return;
  let soft;
  try {
    soft = Number(execFileSync('/bin/sh', ['-c', 'ulimit -n'], { encoding: 'utf8' }).trim());
  } catch {
    return;
  }
  if (!Number.isFinite(soft) || soft >= 1024) return;
  console.warn(
    `Hinweis: File-Descriptor-Limit liegt bei ${soft}. Bei groesseren Ordnerbaeumen kann das\n` +
      '  zu EMFILE fuehren. Im selben Shell-Fenster vorher setzen (ohne Admin-Rechte):\n' +
      '    ulimit -n 4096\n' +
      '  Alternative: mit --poll starten.\n',
  );
}

const label = {
  copy: '+',
  update: '~',
  delete: '-',
  mkdir: 'd',
  rmdir: 'x',
};

checkDescriptorLimit();

let watcher;
try {
  watcher = createCopyWatcher({
    src,
    dest,
    initial: values.initial,
    delete: values.delete,
    poll: values.poll,
    interval: num(values.interval, 'interval'),
    stability: num(values.stability, 'stability'),
    debounce: num(values.debounce, 'debounce'),
    deleteDelay: num(values['delete-delay'], 'delete-delay'),
    retries: num(values.retries, 'retries'),
    ignore: values.ignore.map((p) => new RegExp(p)),
    dryRun: values['dry-run'],
    onEvent: ({ type, rel }) => {
      if (values.quiet) return;
      const prefix = values['dry-run'] ? '[dry] ' : '';
      console.log(`${prefix}${label[type] ?? '?'} ${rel}`);
    },
    onError: (err) => {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') {
        console.error(
          `Fehler: kein Zugriff auf ${err.path ?? 'den Pfad'}.\n` +
            '  Auf macOS koennen ~/Desktop, ~/Documents und ~/Downloads geschuetzt sein.\n' +
            '  Beim ersten Zugriff fragt das System einmalig nach — die Freigabe erfolgt\n' +
            '  fuer das Terminal-Programm unter Systemeinstellungen > Datenschutz & Sicherheit\n' +
            '  > Dateien und Ordner.',
        );
        return;
      }
      console.error(`Fehler: ${err.message}`);
    },
  });
} catch (err) {
  console.error(`Fehler: ${err.message}`);
  process.exit(1);
}

if (!values.quiet) {
  console.log(
    `watching ${path.resolve(src)} -> ${path.resolve(dest)}` +
      (values.poll ? ' (polling)' : '') +
      (values['dry-run'] ? ' (dry run)' : ''),
  );
}

const shutdown = async () => {
  await watcher.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
