/**
 * Reads the Muse skill cards out of `docs/vision-to-3d-muse-skills.md` (PQ-T11). The doc is the source: each
 * card is the first fenced block under its heading. `make skills-gen` writes the result to
 * `cards.generated.ts`; `skills.test.ts` fails when that file is behind the doc.
 */

/** Heading → card key. Archetype headings (`### 5.x \`id\``) are handled apart, one card per backticked id. */
const SECTION_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^## 2\. BASE/, 'base'],
  [/^## 3\. LOOK/, 'look'],
  [/^## 4\. KIT/, 'kit'],
  [/^## 6\. FREE PARTS/, 'free'],
  [/^## 7\. CRITIC/, 'critic'],
  [/^## 8\. STAGE OPS/, 'stages'],
  [/^## 9\. VIEWS CHECK/, 'views'],
  [/^## 10\. FINAL CHECK/, 'final'],
  [/^## 11\. JUDGE/, 'judge'],
  [/^### 12\.1 /, 'side'],
  [/^### 12\.2 /, 'cleanFront'],
];

/** `{ base, look, kit, …, 'archetype:vehicle', … }`, each text trimmed, in doc order. */
export function extractCards(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = markdown.split('\n');
  let keys: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{2,3} /.test(line)) {
      const section = SECTION_KEYS.find(([re]) => re.test(line));
      if (section) keys = [section[1]];
      else if (/^### 5\.\d+ /.test(line))
        keys = [...line.matchAll(/`([a-z_]+)`/g)].map((m) => `archetype:${m[1]}`);
      else keys = [];
      continue;
    }
    if (keys.length === 0 || !line.startsWith('```')) continue;
    const body: string[] = [];
    i++;
    while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
    const text = body.join('\n').trim();
    // Only the first block of a section is the card; later ones are examples.
    for (const k of keys) out[k] = text;
    keys = [];
  }
  return out;
}
