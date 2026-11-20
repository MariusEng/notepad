/**
 * Text encodings Notepad can open and save (WHATWG names: the frontend decodes with TextDecoder, Rust encodes
 * with encoding_rs). UTF-8 is the default; files that aren't valid UTF-8 open as Windows-1252 unless a BOM
 * says otherwise. ISO-8859-1 is read as Windows-1252, its superset, as browsers do.
 */
export const ENCODINGS: { id: string; label: string; short: string }[] = [
  { id: "utf-8", label: "UTF-8", short: "UTF-8" },
  { id: "utf-16le", label: "UTF-16 LE", short: "UTF-16 LE" },
  { id: "utf-16be", label: "UTF-16 BE", short: "UTF-16 BE" },
  { id: "windows-1252", label: "Western (Windows-1252 / ISO-8859-1)", short: "Windows-1252" },
  { id: "iso-8859-15", label: "Western (ISO-8859-15)", short: "ISO-8859-15" },
  { id: "macintosh", label: "Western (Mac Roman)", short: "Mac Roman" },
  { id: "windows-1250", label: "Central European (Windows-1250)", short: "Windows-1250" },
  { id: "iso-8859-2", label: "Central European (ISO-8859-2)", short: "ISO-8859-2" },
  { id: "windows-1257", label: "Baltic (Windows-1257)", short: "Windows-1257" },
  { id: "windows-1251", label: "Cyrillic (Windows-1251)", short: "Windows-1251" },
  { id: "koi8-r", label: "Cyrillic (KOI8-R)", short: "KOI8-R" },
  { id: "ibm866", label: "Cyrillic (DOS 866)", short: "IBM866" },
  { id: "windows-1253", label: "Greek (Windows-1253)", short: "Windows-1253" },
  { id: "windows-1254", label: "Turkish (Windows-1254)", short: "Windows-1254" },
  { id: "windows-1255", label: "Hebrew (Windows-1255)", short: "Windows-1255" },
  { id: "windows-1256", label: "Arabic (Windows-1256)", short: "Windows-1256" },
  { id: "windows-874", label: "Thai (Windows-874)", short: "Windows-874" },
  { id: "windows-1258", label: "Vietnamese (Windows-1258)", short: "Windows-1258" },
  { id: "shift_jis", label: "Japanese (Shift JIS)", short: "Shift JIS" },
  { id: "euc-jp", label: "Japanese (EUC-JP)", short: "EUC-JP" },
  { id: "gb18030", label: "Chinese Simplified (GB18030 / GBK)", short: "GB18030" },
  { id: "big5", label: "Chinese Traditional (Big5)", short: "Big5" },
  { id: "euc-kr", label: "Korean (EUC-KR)", short: "EUC-KR" },
];

export const DEFAULT_ENCODING = "utf-8";

export const encodingName = (id: string, short = true) => {
  const e = ENCODINGS.find((x) => x.id === id);
  return e ? (short ? e.short : e.label) : id;
};

/** UTF-16 files are written with a byte order mark; UTF-8 keeps whatever the file had; others have none. */
export const bomFor = (id: string, current: boolean) => (id.startsWith("utf-16") ? true : id === "utf-8" ? current : false);
