# copy-watch

[![test](https://github.com/jhalitschke/copy-watch/actions/workflows/test.yml/badge.svg)](https://github.com/jhalitschke/copy-watch/actions/workflows/test.yml)

> 🇬🇧 **English version:** see [copy-watch (English)](#copy-watch-english) below.

Beobachtet einen Ordner und spiegelt jede dort geschriebene Datei in ein Zielverzeichnis.
Dünner Wrapper um [chokidar](https://github.com/paulmillr/chokidar) v4 mit den Details,
die in der Praxis beißen: halb geschriebene Dateien, Atomic Saves, Editor-Temporärdateien,
Descriptor-Limits.

Läuft ohne Admin-Rechte. Keine nativen Abhängigkeiten, kein `node-gyp`, keine Xcode
Command Line Tools — chokidar 4 hat `fsevents` fallen gelassen und nutzt nur noch die
Bordmittel von Node.

**Voraussetzung:** Node ≥ 18.3 (wegen `util.parseArgs`).

---

## Installation

### Ohne Admin-Rechte (empfohlen)

Global installieren schreibt nach `/usr/local` und will `sudo`. Drei Wege, die das umgehen:

**Als Projekt-Abhängigkeit** — die naheliegende Variante, wenn der Watcher zu einem
konkreten Projekt gehört:

```bash
npm install --save-dev copy-watch
```

Dann in `package.json`:

```json
{
  "scripts": {
    "sync": "copy-watch ./dist ~/Sites/preview --initial --delete"
  }
}
```

`npm run sync` findet das Binary über `node_modules/.bin`, ohne dass irgendetwas global liegt.

**Per npx, ohne feste Installation:**

```bash
npx copy-watch ./dist ~/Sites/preview --initial
```

**Global, aber im Home-Verzeichnis** — falls du das Tool projektübergreifend brauchst:

```bash
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm install -g copy-watch
```

Wenn Node selbst über nvm, fnm oder Homebrew im User-Kontext liegt, ist `npm i -g` ohnehin
schon schreibbar und der Umweg entfällt.

### Direkt aus dem Repo

```bash
git clone <repo> ~/tools/copy-watch
cd ~/tools/copy-watch
npm install
node bin/cli.js --help
```

---

## CLI

```
copy-watch <quelle> <ziel> [optionen]
```

| Option | Default | Bedeutung |
| --- | --- | --- |
| `-i`, `--initial` | aus | Vorhandenen Bestand beim Start einmal kopieren |
| `-d`, `--delete` | aus | Im Ziel löschen, was in der Quelle gelöscht wurde |
| `-p`, `--poll` | aus | Polling statt Kernel-Events (Netzlaufwerke, VM-Shares) |
| `--interval <ms>` | 500 | Polling-Intervall |
| `--stability <ms>` | 300 | Wartezeit, bis eine Datei als fertig geschrieben gilt |
| `--debounce <ms>` | 50 | Mehrere Events pro Datei zusammenfassen |
| `--delete-delay <ms>` | 400 | Karenzzeit vor dem Löschen im Ziel |
| `--retries <n>` | 5 | Wiederholungen bei `EMFILE`/`ENFILE` |
| `--ignore <regex>` | – | Zusätzliches Ignore-Muster, mehrfach verwendbar |
| `--dry-run` | aus | Nur ausgeben, was passieren würde |
| `-q`, `--quiet` | aus | Keine Ausgabe pro Datei |

Beispiele:

```bash
# Build-Output in einen lokalen Webroot spiegeln
copy-watch ./dist ~/Sites/preview --initial --delete

# auf ein gemountetes Share, wo Kernel-Events nicht durchkommen
copy-watch ./src /Volumes/team-share/inbox --poll --interval 1000

# Sourcemaps und Build-Statistiken draußen lassen
copy-watch ./build ./deploy --ignore '\.map$' --ignore '^stats\.json$'

# erst mal schauen, was passieren würde
copy-watch ./dist ~/Sites/preview --initial --dry-run
```

Ausgabeformat: `+` neu kopiert, `~` aktualisiert, `-` gelöscht, `d` Verzeichnis angelegt,
`x` Verzeichnis entfernt.

Beenden mit `Ctrl-C`; der Watcher wird sauber geschlossen.

---

## Als Modul

```js
import { createCopyWatcher } from 'copy-watch';

const watcher = createCopyWatcher({
  src: './dist',
  dest: '/Users/joerg/Sites/preview',
  initial: true,
  delete: true,
  ignore: [/\.map$/],
  onEvent: ({ type, rel, to }) => {
    console.log(type, rel);
    // hier z.B. Cache purgen, Reload triggern, Deploy anstoßen
  },
  onError: (err) => console.error(err),
});

watcher.on('ready', () => console.log('initialer Scan fertig'));

// später
await watcher.close();
```

Rückgabewert ist die chokidar-`FSWatcher`-Instanz, du kommst also an alle Original-Events
(`ready`, `all`, …) heran. `close()` ist überschrieben und räumt zusätzlich die internen
Timer ab.

### Optionen

Alle CLI-Optionen existieren als camelCase-Feld: `initial`, `delete`, `poll`, `interval`,
`stability`, `debounce`, `deleteDelay`, `retries`, `ignore` (Array aus RegExp oder String),
`dryRun`, dazu `onEvent` und `onError`.

`onEvent` bekommt `{ type, from, to, rel }` mit `type` aus
`copy | update | delete | mkdir | rmdir`.

---

## macOS

### Rechte

Nichts am Tool braucht Admin-Rechte. Was ein Passwort verlangt, ist ausschließlich das
Ziel selbst: `/Library`, `/usr/local`, `/Applications` und der Rest außerhalb von `$HOME`
gehören root. Innerhalb von `~` — `~/Sites`, `~/Projects`, `~/Library/…` — schreibst du frei.

Zwei Dinge, die wie fehlende Rechte aussehen, aber keine sind:

**Geschützte Ordner (TCC).** `~/Desktop`, `~/Documents` und `~/Downloads` liegen hinter
Apples Privacy-Layer. Beim ersten Zugriff fragt macOS einmalig nach; die Freigabe gilt für
das *Terminal-Programm*, nicht für das Skript. Falls du versehentlich abgelehnt hast:
Systemeinstellungen → Datenschutz & Sicherheit → Dateien und Ordner → Terminal (bzw. iTerm)
freigeben. Das ist eine Benutzer-Entscheidung, kein Admin-Vorgang. Der Watcher meldet
`EACCES`/`EPERM` mit genau diesem Hinweis. Am einfachsten arbeitest du unterhalb eines
unproblematischen Pfads wie `~/Projects` oder `~/Sites`.

**Descriptor-Limit.** macOS startet Shells mit `ulimit -n 256`. Chokidar öffnet pro
Verzeichnis einen Watch, ein tiefer Baum reißt das Limit und du bekommst `EMFILE`. Das
Soft-Limit lässt sich bis zum Hard-Limit ohne Admin anheben:

```bash
ulimit -n 4096          # gilt fürs aktuelle Shell-Fenster
```

Dauerhaft dann in `~/.zshrc`. Das Hard-Limit (`ulimit -Hn`) liegt auf modernen Systemen
hoch genug; nur ein Anheben *darüber* bräuchte root. Die CLI prüft das beim Start und warnt,
wenn das Limit unter 1024 liegt. Alternative ohne jede Anpassung: `--poll` — kostet CPU,
öffnet aber keine Descriptor-Flut.

### Watch-Mechanismus

Seit chokidar 4 gibt es kein `fsevents` mehr, es läuft alles über `fs.watch`. Konsequenz:
kein Kompilieren bei der Installation, dafür ein Watch pro Verzeichnis statt eines
FSEvents-Streams für den ganzen Baum — siehe Descriptor-Limit oben. Für Ordner in der
Größenordnung eines Build-Outputs ist das folgenlos.

Auf gemounteten Volumes (SMB, NFS, `/Volumes/…`, VM-Shares, Docker-Bind-Mounts) kommen
Kernel-Events oft gar nicht an. Dort ist `--poll` nicht optional, sondern die einzige
Variante, die funktioniert.

### Atomic Saves

Viele macOS-Programme speichern nicht in die Zieldatei, sondern schreiben eine
Temporärdatei und benennen sie um. Naiv beobachtet sieht das aus wie „Datei gelöscht,
andere Datei erschienen" — mit `--delete` würde die Zieldatei kurz verschwinden oder
schlimmstenfalls gelöscht bleiben. Deshalb wird jede Löschung um `--delete-delay`
verzögert und verworfen, sobald der Pfad in der Karenzzeit wieder auftaucht. Bei sehr
langsamen Zielen (Netzlaufwerk) den Wert erhöhen.

### Was ignoriert wird

Voreingestellt draußen: `.git`, `node_modules`, `.DS_Store`, `.Spotlight-V100`, `.Trashes`,
`.fseventsd`, AppleDouble-Reste (`._name`, entstehen beim Kopieren auf exFAT- und
SMB-Volumes), iCloud-Platzhalter (`*.icloud`), Atomic-Save-Verzeichnisse (`.sb-*`) sowie
`*~`, `*.swp`, `*.tmp`, `*.crdownload`, `*.part` und vims `4913`.

Bewusst **nicht** pauschal alle Dotfiles — sonst fielen `.htaccess`, `.env` oder
`.well-known` mit weg.

### iCloud Drive

Liegt die Quelle in iCloud Drive, können Dateien „ausgelagert" sein: sichtbar im Finder,
lokal aber nur ein Platzhalter. Der Lesezugriff löst dann einen Download aus und kann
hängen oder fehlschlagen. Die `.icloud`-Platzhalter selbst werden ignoriert. Für einen
Watcher ist iCloud Drive als Quelle grundsätzlich keine gute Wahl — besser ein normaler
lokaler Pfad.

### Metadaten

`fs.cp` kopiert Inhalt und Mode, aber keine erweiterten Attribute, Finder-Tags oder
Resource-Forks. Wenn du die brauchst — etwa beim Spiegeln von Design-Dateien oder
signierten Bundles — ist `ditto` das passendere Werkzeug:

```bash
ditto --rsrc --extattr quelle ziel
```

Für Build-Artefakte, Code und Assets spielt das keine Rolle.

### Autostart ohne Admin

Ein LaunchAgent in `~/Library/LaunchAgents` läuft im Benutzerkontext und braucht kein
`sudo` — im Gegensatz zu `/Library/LaunchDaemons`. Template liegt unter
`examples/local.copy-watch.plist`; Pfade anpassen, dann:

```bash
cp examples/local.copy-watch.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.copy-watch.plist

launchctl print gui/$(id -u)/local.copy-watch      # Status
launchctl bootout gui/$(id -u)/local.copy-watch    # stoppen
```

Zwei Stolpersteine: `ProgramArguments` braucht absolute Pfade, weil launchd keine
Login-Shell-`PATH` kennt (`which node` liefert dir den richtigen Node-Pfad, bei nvm zeigt
der auf die konkrete Version). Und launchd erbt nicht das `ulimit` deiner Shell — dafür
steht `SoftResourceLimits` im Template.

---

## Wann sich das nicht lohnt

Wenn du nur Dateien von A nach B spiegeln willst und nichts weiter, tut `rsync` das seit
Jahrzehnten zuverlässiger:

```bash
rsync -a --delete ./dist/ ~/Sites/preview/
```

macOS liefert eine sehr alte rsync-Version mit, für den Zweck reicht sie. In Kombination
mit `fswatch` (per Homebrew, ohne Admin installierbar) hast du dasselbe Ergebnis in zwei
Zeilen Shell.

copy-watch lohnt sich, sobald pro Datei noch etwas passieren soll: Cache purgen, Reload
auslösen, transformieren, einen Deploy triggern. Dafür ist `onEvent` da.

---

## Tests

```bash
npm run smoke
```

Legt ein temporäres Verzeichnispaar an und prüft Anlegen, Ändern, verschachtelte Ordner,
Ignore-Muster, Umlaute in Dateinamen, Atomic Saves und Löschen.

## Lizenz

MIT

---

# copy-watch (English)

> 🇩🇪 Die deutsche Fassung steht [oben in diesem Dokument](#copy-watch).

Watches a folder and mirrors every file written there into a target directory.
A thin wrapper around [chokidar](https://github.com/paulmillr/chokidar) v4, covering the
details that bite in practice: half-written files, atomic saves, editor temp files,
descriptor limits.

Runs without admin rights. No native dependencies, no `node-gyp`, no Xcode Command Line
Tools — chokidar 4 dropped `fsevents` and relies on Node's built-ins only.

**Requirement:** Node ≥ 18.3 (because of `util.parseArgs`).

---

## Installation

### Without admin rights (recommended)

A global install writes to `/usr/local` and wants `sudo`. Three ways around that:

**As a project dependency** — the obvious option when the watcher belongs to a specific
project:

```bash
npm install --save-dev copy-watch
```

Then in `package.json`:

```json
{
  "scripts": {
    "sync": "copy-watch ./dist ~/Sites/preview --initial --delete"
  }
}
```

`npm run sync` finds the binary via `node_modules/.bin`, without anything living globally.

**Via npx, without a permanent install:**

```bash
npx copy-watch ./dist ~/Sites/preview --initial
```

**Globally, but inside your home directory** — if you need the tool across projects:

```bash
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm install -g copy-watch
```

If Node itself lives in user space via nvm, fnm or Homebrew, `npm i -g` is already writable
anyway and the detour is unnecessary.

### Straight from the repo

```bash
git clone <repo> ~/tools/copy-watch
cd ~/tools/copy-watch
npm install
node bin/cli.js --help
```

---

## CLI

```
copy-watch <source> <target> [options]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `-i`, `--initial` | off | Copy the existing contents once at startup |
| `-d`, `--delete` | off | Delete in the target what was deleted in the source |
| `-p`, `--poll` | off | Polling instead of kernel events (network drives, VM shares) |
| `--interval <ms>` | 500 | Polling interval |
| `--stability <ms>` | 300 | Wait time until a file counts as fully written |
| `--debounce <ms>` | 50 | Coalesce multiple events per file |
| `--delete-delay <ms>` | 400 | Grace period before deleting in the target |
| `--retries <n>` | 5 | Retries on `EMFILE`/`ENFILE` |
| `--ignore <regex>` | – | Additional ignore pattern, can be given multiple times |
| `--dry-run` | off | Only print what would happen |
| `-q`, `--quiet` | off | No per-file output |

Examples:

```bash
# mirror build output into a local webroot
copy-watch ./dist ~/Sites/preview --initial --delete

# onto a mounted share where kernel events don't get through
copy-watch ./src /Volumes/team-share/inbox --poll --interval 1000

# leave source maps and build stats out
copy-watch ./build ./deploy --ignore '\.map$' --ignore '^stats\.json$'

# just see what would happen first
copy-watch ./dist ~/Sites/preview --initial --dry-run
```

Output format: `+` newly copied, `~` updated, `-` deleted, `d` directory created,
`x` directory removed.

Quit with `Ctrl-C`; the watcher is closed cleanly.

---

## As a module

```js
import { createCopyWatcher } from 'copy-watch';

const watcher = createCopyWatcher({
  src: './dist',
  dest: '/Users/joerg/Sites/preview',
  initial: true,
  delete: true,
  ignore: [/\.map$/],
  onEvent: ({ type, rel, to }) => {
    console.log(type, rel);
    // e.g. purge a cache, trigger a reload, kick off a deploy here
  },
  onError: (err) => console.error(err),
});

watcher.on('ready', () => console.log('initial scan complete'));

// later on
await watcher.close();
```

The return value is the chokidar `FSWatcher` instance, so you have access to all the
original events (`ready`, `all`, …). `close()` is overridden and additionally clears the
internal timers.

### Options

Every CLI option exists as a camelCase field: `initial`, `delete`, `poll`, `interval`,
`stability`, `debounce`, `deleteDelay`, `retries`, `ignore` (array of RegExp or string),
`dryRun`, plus `onEvent` and `onError`.

`onEvent` receives `{ type, from, to, rel }` with `type` being one of
`copy | update | delete | mkdir | rmdir`.

---

## macOS

### Permissions

Nothing about the tool needs admin rights. The only thing that asks for a password is the
target itself: `/Library`, `/usr/local`, `/Applications` and everything else outside of
`$HOME` belong to root. Inside `~` — `~/Sites`, `~/Projects`, `~/Library/…` — you can write
freely.

Two things that look like missing permissions but aren't:

**Protected folders (TCC).** `~/Desktop`, `~/Documents` and `~/Downloads` sit behind
Apple's privacy layer. On first access macOS asks once; the grant applies to the *terminal
application*, not to the script. If you denied it by accident: System Settings → Privacy &
Security → Files and Folders → grant access to Terminal (or iTerm). That's a user decision,
not an admin operation. The watcher reports `EACCES`/`EPERM` with exactly that hint. The
easiest approach is to work below an unproblematic path such as `~/Projects` or `~/Sites`.

**Descriptor limit.** macOS starts shells with `ulimit -n 256`. Chokidar opens one watch
per directory, a deep tree blows past the limit and you get `EMFILE`. The soft limit can be
raised up to the hard limit without admin rights:

```bash
ulimit -n 4096          # applies to the current shell window
```

For a permanent change, put it in `~/.zshrc`. The hard limit (`ulimit -Hn`) is high enough
on modern systems; only raising it *beyond* that would need root. The CLI checks this at
startup and warns if the limit is below 1024. Alternative without any tweaking: `--poll` —
it costs CPU, but doesn't open a flood of descriptors.

### Watch mechanism

Since chokidar 4 there is no `fsevents` any more, everything goes through `fs.watch`. The
consequence: no compilation at install time, but one watch per directory instead of a
single FSEvents stream for the whole tree — see the descriptor limit above. For folders the
size of a build output this is inconsequential.

On mounted volumes (SMB, NFS, `/Volumes/…`, VM shares, Docker bind mounts) kernel events
often don't arrive at all. There `--poll` isn't optional, it's the only variant that works.

### Atomic saves

Many macOS programs don't save into the target file, they write a temp file and rename it.
Watched naively this looks like "file deleted, another file appeared" — with `--delete` the
target file would briefly vanish, or in the worst case stay deleted. That's why every
deletion is delayed by `--delete-delay` and discarded as soon as the path reappears within
the grace period. For very slow targets (network drives) increase the value.

### What is ignored

Excluded by default: `.git`, `node_modules`, `.DS_Store`, `.Spotlight-V100`, `.Trashes`,
`.fseventsd`, AppleDouble leftovers (`._name`, created when copying onto exFAT and SMB
volumes), iCloud placeholders (`*.icloud`), atomic-save directories (`.sb-*`) as well as
`*~`, `*.swp`, `*.tmp`, `*.crdownload`, `*.part` and vim's `4913`.

Deliberately **not** all dotfiles across the board — otherwise `.htaccess`, `.env` or
`.well-known` would drop out too.

### iCloud Drive

If the source lives in iCloud Drive, files can be "evicted": visible in the Finder, but
only a placeholder locally. Read access then triggers a download and may hang or fail. The
`.icloud` placeholders themselves are ignored. For a watcher, iCloud Drive is fundamentally
a poor choice as a source — better use a normal local path.

### Metadata

`fs.cp` copies content and mode, but no extended attributes, Finder tags or resource forks.
If you need those — say when mirroring design files or signed bundles — `ditto` is the more
appropriate tool:

```bash
ditto --rsrc --extattr source target
```

For build artifacts, code and assets it makes no difference.

### Autostart without admin rights

A LaunchAgent in `~/Library/LaunchAgents` runs in the user context and needs no `sudo` —
unlike `/Library/LaunchDaemons`. A template lives at `examples/local.copy-watch.plist`;
adjust the paths, then:

```bash
cp examples/local.copy-watch.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.copy-watch.plist

launchctl print gui/$(id -u)/local.copy-watch      # status
launchctl bootout gui/$(id -u)/local.copy-watch    # stop
```

Two pitfalls: `ProgramArguments` needs absolute paths, because launchd knows nothing about
your login shell's `PATH` (`which node` gives you the right Node path; with nvm it points at
the specific version). And launchd doesn't inherit your shell's `ulimit` — that's what
`SoftResourceLimits` in the template is for.

---

## When this isn't worth it

If all you want is to mirror files from A to B and nothing else, `rsync` has been doing that
more reliably for decades:

```bash
rsync -a --delete ./dist/ ~/Sites/preview/
```

macOS ships a very old rsync version, but for this purpose it's good enough. Combined with
`fswatch` (via Homebrew, installable without admin rights) you get the same result in two
lines of shell.

copy-watch pays off as soon as something should happen per file: purging a cache, triggering
a reload, transforming, kicking off a deploy. That's what `onEvent` is for.

---

## Tests

```bash
npm run smoke
```

Creates a temporary pair of directories and checks creation, modification, nested folders,
ignore patterns, umlauts in file names, atomic saves and deletion.

## License

MIT
