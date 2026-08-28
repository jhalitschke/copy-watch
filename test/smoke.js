import { mkdtemp, writeFile, readFile, rm, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCopyWatcher } from '../src/index.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await wait(50);
  }
  throw new Error('timeout');
};

const root = await mkdtemp(path.join(tmpdir(), 'copy-watch-'));
const src = path.join(root, 'src');
const dest = path.join(root, 'dest');
await mkdir(src, { recursive: true });

const errors = [];
const watcher = createCopyWatcher({
  src,
  dest,
  delete: true,
  stability: 100,
  debounce: 20,
  deleteDelay: 300,
  onError: (err) => errors.push(err),
});
await new Promise((resolve) => watcher.on('ready', resolve));

await writeFile(path.join(src, 'a.txt'), 'eins');
await until(() => existsSync(path.join(dest, 'a.txt')));
assert.equal(await readFile(path.join(dest, 'a.txt'), 'utf8'), 'eins');
console.log('ok  add');

await mkdir(path.join(src, 'nested'), { recursive: true });
await writeFile(path.join(src, 'nested/b.txt'), 'zwei');
await until(() => existsSync(path.join(dest, 'nested/b.txt')));
console.log('ok  nested add');

await writeFile(path.join(src, 'a.txt'), 'drei');
await until(async () => (await readFile(path.join(dest, 'a.txt'), 'utf8')) === 'drei');
console.log('ok  change');

// Dotfiles wie .htaccess muessen erhalten bleiben.
await writeFile(path.join(src, '.htaccess'), 'RewriteEngine On');
await until(() => existsSync(path.join(dest, '.htaccess')));
console.log('ok  dotfile bleibt erhalten');

// macOS-Metadaten und Resource-Forks nicht.
await writeFile(path.join(src, '.DS_Store'), 'finder');
await writeFile(path.join(src, '._a.txt'), 'resource fork');
await writeFile(path.join(src, 'c.txt.tmp'), 'ignoriert');
await wait(700);
assert.ok(!existsSync(path.join(dest, '.DS_Store')), '.DS_Store kopiert');
assert.ok(!existsSync(path.join(dest, '._a.txt')), 'AppleDouble kopiert');
assert.ok(!existsSync(path.join(dest, 'c.txt.tmp')), 'tmp kopiert');
console.log('ok  ignore (.DS_Store, ._*, .tmp)');

// Umlaute im Dateinamen (macOS liefert je nach Volume NFD statt NFC).
await writeFile(path.join(src, 'größe-übersicht.txt'), 'umlaute');
await until(() => existsSync(path.join(dest, 'größe-übersicht.txt')));
console.log('ok  umlaute im dateinamen');

// Atomic Save: unlink + rename, wie es macOS-Editoren machen.
// Die Zieldatei darf dabei nicht verschwinden.
await writeFile(path.join(src, 'atomic.txt'), 'alt');
await until(() => existsSync(path.join(dest, 'atomic.txt')));
await writeFile(path.join(src, '.atomic.txt.sb-tmp'), 'neu');
await rm(path.join(src, 'atomic.txt'));
await rename(path.join(src, '.atomic.txt.sb-tmp'), path.join(src, 'atomic.txt'));
await until(async () => (await readFile(path.join(dest, 'atomic.txt'), 'utf8')) === 'neu');
await wait(600); // Karenzzeit der verzoegerten Loeschung abwarten
assert.ok(existsSync(path.join(dest, 'atomic.txt')), 'atomic save hat das ziel geloescht');
console.log('ok  atomic save (unlink + rename)');

await rm(path.join(src, 'a.txt'));
await until(() => !existsSync(path.join(dest, 'a.txt')));
console.log('ok  unlink');

assert.equal(errors.length, 0, `unerwartete fehler: ${errors.map((e) => e.message).join(', ')}`);

await watcher.close();
await rm(root, { recursive: true, force: true });
console.log('\nalle checks bestanden');
