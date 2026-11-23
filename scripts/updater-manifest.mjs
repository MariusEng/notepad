#!/usr/bin/env node
// Writes latest.json for the app's updater (tauri-plugin-updater) from the signed update files of a release:
//
//   node scripts/updater-manifest.mjs <tag> <notes file> <folder with the files and their .sig> > latest.json
//
// It is uploaded last to the GitHub release (published only when complete); the app reads
// https://github.com/MariusEng/notepad/releases/latest/download/latest.json (tauri.conf.json → plugins.updater) and
// downloads from that release. A copy also goes to deling.1011.no for 0.17.0, which looked there. The updater looks for "<os>-<arch>-<bundle type>" first, then "<os>-<arch>":
//   macOS   Notepad_<v>_aarch64.app.tar.gz   darwin-aarch64(-app)
//   Windows Notepad_<v>_x64-setup.exe        windows-x86_64(-nsis)
//   Linux   .AppImage / .deb / .rpm          linux-x86_64-appimage, -deb, -rpm
// A file without a .sig next to it is left out (that platform then gets no update offer).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const [tag, notesFile, dir] = process.argv.slice(2);
if (!tag || !notesFile || !dir) {
  console.error("usage: updater-manifest.mjs <tag> <notes file> <folder>");
  process.exit(1);
}
const base = process.env.UPDATE_BASE_URL || `https://github.com/MariusEng/notepad/releases/download/${tag}/`;

/** Every file under `dir` (the release job has one subfolder per build). */
const files = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : [join(d, n)]));
const all = files(dir);

const kinds = [
  { test: /\.app\.tar\.gz$/, keys: ["darwin-aarch64", "darwin-aarch64-app"] },
  { test: /-setup\.exe$/, keys: ["windows-x86_64", "windows-x86_64-nsis"] },
  // No plain "linux-x86_64": a .deb/.rpm install without its own entry would fall back to it and get the AppImage.
  { test: /\.AppImage$/, keys: ["linux-x86_64-appimage"] },
  { test: /\.deb$/, keys: ["linux-x86_64-deb"] },
  { test: /\.rpm$/, keys: ["linux-x86_64-rpm"] },
];

const platforms = {};
for (const f of all) {
  const kind = kinds.find((k) => k.test.test(f));
  if (!kind) continue;
  let signature;
  try {
    signature = readFileSync(`${f}.sig`, "utf8").trim();
  } catch {
    console.error(`no signature for ${basename(f)}: left out of latest.json`);
    continue;
  }
  const url = base + encodeURIComponent(basename(f));
  for (const key of kind.keys) platforms[key] = { signature, url };
}
if (!Object.keys(platforms).length) {
  console.error("no signed update files found");
  process.exit(1);
}

const manifest = {
  version: tag.replace(/^v/, ""),
  notes: readFileSync(notesFile, "utf8").trim(),
  pub_date: new Date().toISOString(),
  platforms,
};
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
console.error(`latest.json: ${Object.keys(platforms).join(", ")}`);
