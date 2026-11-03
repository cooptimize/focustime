// The modules a source file imports (static, side-effect, dynamic and require), for the import-boundary tests.
export function importsOf(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/gm)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4])!);
}
