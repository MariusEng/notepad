import { convertFileSrc, invoke } from "@tauri-apps/api/core";

/**
 * Markdown images with relative paths (`![](images/a.png)`, `![](../shared/b.jpg)`) are resolved against the
 * document's folder and shown through Tauri's asset protocol. The Markdown text keeps the relative path.
 */

/** Addresses the webview can show as they are. */
const SHOWABLE = /^(https?:|data:|blob:|asset:|tauri:|http:\/\/asset\.localhost)/i;

/**
 * The absolute file path an image address in `docPath` points to, or null when it isn't a local file (web
 * address, data: URL…) or can't be resolved (untitled document with a relative path).
 */
export function resolveImagePath(docPath: string | null, url: string): string | null {
  let u = url.trim().replace(/^<(.*)>$/, "$1");
  if (!u || SHOWABLE.test(u) || u.startsWith("#")) return null;
  const win = docPath ? /^[A-Za-z]:[\\/]/.test(docPath) || docPath.startsWith("\\\\") : false;
  if (/^file:\/\//i.test(u)) {
    u = u.replace(/^file:\/\/(localhost)?/i, "");
    if (/^\/[A-Za-z]:\//.test(u)) u = u.slice(1); // file:///C:/x → C:/x
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^[A-Za-z]:[\\/]/.test(u)) {
    return null; // some other scheme (mailto:, ftp:…)
  }
  u = u.split(/[?#]/)[0];
  try {
    u = decodeURI(u); // "my%20image.png" → "my image.png"
  } catch {
    /* not percent-encoded after all */
  }
  const absolute = u.startsWith("/") || /^[A-Za-z]:[\\/]/.test(u) || u.startsWith("\\\\");
  let joined: string;
  if (absolute) joined = u;
  else {
    if (!docPath) return null;
    const dir = docPath.replace(/[\\/][^\\/]*$/, "");
    joined = `${dir}/${u}`;
  }
  // Normalise "." and ".." (keeping a Windows drive or UNC prefix, and the leading "/" on unix).
  const parts = joined.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const [i, p] of parts.entries()) {
    if (p === "." || (p === "" && i > 0)) continue;
    if (p === "..") {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(p);
  }
  const path = out.join("/") || "/";
  return win ? path.replace(/\//g, "\\") : path;
}

/** Turns an image address into one the webview can load (asking the backend to allow that one file). */
export async function showableImageUrl(docPath: string | null, url: string): Promise<string> {
  const path = resolveImagePath(docPath, url);
  if (!path) return url;
  try {
    return convertFileSrc(await invoke<string>("allow_image", { path }));
  } catch {
    return url; // missing or not an image: the editor shows its broken-image state
  }
}
