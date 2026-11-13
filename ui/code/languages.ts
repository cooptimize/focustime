// RB-1 D10: a file's language, from its name and, for a file with no telling name, its first lines. The one table:
// nothing else picks a language. Anything not here is plain text. Pure (no Prism here, so the tests and the panel's
// first paint don't load the coloring library).

export type Lang = "sql" | "json" | "tmdl" | "dax" | "powerquery" | "python" | "yaml" | "xml" | "powershell" | "markdown" | "plain";

export const LANG_NAMES: Record<Lang, string> = {
  sql: "SQL",
  json: "JSON",
  tmdl: "TMDL",
  dax: "DAX",
  powerquery: "Power Query (M)",
  python: "Python",
  yaml: "YAML",
  xml: "XML",
  powershell: "PowerShell",
  markdown: "Markdown",
  plain: "Plain text",
};

/** By extension (lower case, without the dot). */
const BY_EXT: Readonly<Record<string, Lang>> = {
  sql: "sql",
  // SQL project files are MSBuild XML: colored as XML.
  sqlproj: "xml",
  json: "json",
  jsonc: "json",
  // Fabric and Power BI definitions: item metadata, report and model definitions, datasets and pipelines.
  platform: "json",
  pbir: "json",
  pbism: "json",
  pbip: "json",
  bim: "json",
  pbidataset: "json",
  pbireport: "json",
  ipynb: "json",
  tmdl: "tmdl",
  tmd: "tmdl",
  dax: "dax",
  msdax: "dax",
  pq: "powerquery",
  pqm: "powerquery",
  m: "powerquery",
  py: "python",
  pyi: "python",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  xsd: "xml",
  xsl: "xml",
  config: "xml",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  dtsx: "xml",
  rdl: "xml",
  svg: "xml",
  html: "xml",
  htm: "xml",
  resx: "xml",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  md: "markdown",
  markdown: "markdown",
};

/** By whole file name (lower case), for names without a telling extension. */
const BY_NAME: Readonly<Record<string, Lang>> = { ".platform": "json", "azure-pipelines.yml": "yaml", dockerfile: "plain" };

/** First lines, in order, for a file whose name says nothing. */
const SNIFF: readonly [RegExp, Lang][] = [
  [/^\s*<\?xml\b/, "xml"],
  [/^# Fabric notebook source/, "python"],
  [/^#!.*\bpython/, "python"],
  [/^#!.*\bpwsh\b/, "powershell"],
  [/^(createOrReplace|model|table|database|expression|relationship|role|perspective|culture)\b[^\n]*\n\t/m, "tmdl"],
  [/^\s*[{[]/, "json"],
  [/^\s*(SELECT|CREATE|ALTER|INSERT|UPDATE|DELETE|WITH|DECLARE|USE|SET|EXEC|MERGE)\b/i, "sql"],
  [/^\s*(param\s*\(|<#|function\s+[A-Z][a-z]+-[A-Z])/, "powershell"],
  [/^\s*let\b[\s\S]*\bin\b/, "powerquery"],
  [/^---\s*$|^[A-Za-z_][\w-]*:\s/, "yaml"],
  [/^#{1,6} \S/, "markdown"],
];

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : name.startsWith(".") ? name.slice(1).toLowerCase() : "";
};

/** The language of a file, from its name, then its first lines. */
export function languageOf(name: string, text: string | null = null): Lang {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  const byExt = BY_EXT[extOf(lower)];
  if (byExt) return byExt;
  if (text) {
    const head = text.slice(0, 2000);
    for (const [re, lang] of SNIFF) if (re.test(head)) return lang;
  }
  return "plain";
}

/** D10: a file past this many lines or characters is shown plain (coloring is off for large files). */
export const COLOR_MAX_LINES = 5_000;
export const COLOR_MAX_CHARS = 300 * 1024;
export const tooLargeToColor = (text: string): boolean => text.length > COLOR_MAX_CHARS || lineCount(text) > COLOR_MAX_LINES;
export function lineCount(text: string): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) n++;
  return text.endsWith("\n") ? n - 1 : n;
}
