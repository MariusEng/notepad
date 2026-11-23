import { useEffect, useState } from "react";
import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";
import { git } from "./lib/backend";

const useAbout = create<{ open: boolean }>(() => ({ open: false }));
export const openAbout = () => useAbout.setState({ open: true });
const close = () => useAbout.setState({ open: false });

/** Open source components included in the app (licences as published by each project). */
const COMPONENTS: { name: string; use: string; license: string; url: string }[] = [
  { name: "Tauri 2", use: "app framework, native menus and windows, single-instance and dialog plugins", license: "MIT / Apache-2.0", url: "https://tauri.app" },
  { name: "React", use: "user interface", license: "MIT", url: "https://react.dev" },
  { name: "CodeMirror 6 and Lezer", use: "code editor and syntax highlighting", license: "MIT", url: "https://codemirror.net" },
  { name: "Milkdown (Crepe) and ProseMirror", use: "formatted Markdown editor", license: "MIT", url: "https://milkdown.dev" },
  { name: "Prettier", use: "formatting JavaScript, HTML, Markdown and YAML", license: "MIT", url: "https://prettier.io" },
  { name: "@prettier/plugin-xml", use: "formatting XML", license: "MIT", url: "https://github.com/prettier/plugin-xml" },
  { name: "sql-formatter", use: "formatting SQL", license: "MIT", url: "https://github.com/sql-formatter-org/sql-formatter" },
  { name: "Zustand", use: "app state", license: "MIT", url: "https://github.com/pmndrs/zustand" },
  { name: "libgit2 and git2-rs", use: "git repositories", license: "GPL-2.0 with linking exception / MIT, Apache-2.0", url: "https://libgit2.org" },
  { name: "OpenSSL", use: "HTTPS for git (macOS and Linux)", license: "Apache-2.0", url: "https://www.openssl.org" },
  { name: "encoding_rs", use: "saving in other text encodings", license: "MIT / Apache-2.0", url: "https://github.com/hsivonen/encoding_rs" },
  { name: "keyring-rs", use: "storing sign-ins in the system keychain", license: "MIT / Apache-2.0", url: "https://github.com/hwchen/keyring-rs" },
  { name: "SQLite and rusqlite", use: "SQLite databases", license: "Public domain / MIT", url: "https://sqlite.org" },
  { name: "trash", use: "moving deleted files to the Trash", license: "MIT", url: "https://github.com/ArturKovacs/trash" },
  { name: "ureq, url, serde, RustCrypto sha2, base64, getrandom", use: "web requests and data handling", license: "MIT / Apache-2.0", url: "https://crates.io" },
  { name: "Vite and TypeScript", use: "build tools", license: "MIT / Apache-2.0", url: "https://vite.dev" },
];

export function AboutDialog() {
  const open = useAbout((s) => s.open);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (open && !version) getVersion().then(setVersion).catch(() => {});
  }, [open, version]);
  if (!open) return null;
  const link = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    void git.openExternal(url);
  };
  return (
    <div className="picker-backdrop" onMouseDown={close}>
      <div className="dialog about" role="dialog" aria-label="About Notepad" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()} tabIndex={-1} ref={(el) => el?.focus()}>
        <h2>Notepad {version}</h2>
        <p className="note">
          A minimal notepad with formatted Markdown, syntax highlighting and git sync. Open source under the MIT
          license.
          <br />
          Built with <b>Claude</b> by Anthropic, using{" "}
          <a href="https://claude.com/claude-code" onClick={link("https://claude.com/claude-code")}>
            Claude Code
          </a>
          .
        </p>
        <h3>Open source components</h3>
        <ul className="about-list">
          {COMPONENTS.map((c) => (
            <li key={c.name}>
              <a href={c.url} onClick={link(c.url)}>
                {c.name}
              </a>{" "}
              <span className="about-use">— {c.use}</span>
              <span className="about-license">{c.license}</span>
            </li>
          ))}
        </ul>
        <p className="field-hint">
          Optional formatters are used when installed and are not included: shfmt, perltidy and PSScriptAnalyzer.
        </p>
        <div className="dialog-actions">
          <span className="sb-spacer" />
          <button className="btn primary" onClick={close}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
