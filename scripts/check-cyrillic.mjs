#!/usr/bin/env node
/**
 * Ratchet for the switch of code to English (docs stay Russian, see AGENTS.md):
 * per tracked file, the number of lines containing Cyrillic may only go down.
 * The baseline lives in scripts/cyrillic-baseline.json; a file missing from it is held to zero.
 * Markdown and `.claude/` are out of scope — they are documentation — except the public pages
 * `docs/public/*.md`: the docs site (diode-editor.github.io/docs) publishes them in English.
 *
 *   node scripts/check-cyrillic.mjs            fail if any file exceeds its baseline
 *   node scripts/check-cyrillic.mjs --update   lower the baseline to current counts (never raises)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { compare, lowered } from "./ratchet.mjs";

const BASELINE = "scripts/cyrillic-baseline.json";
export const CYRILLIC = /[\u0400-\u04ff]/;
// Docs stay Russian, so a link into them carries a Russian anchor: `docs/STYLE.md#комментарии`.
const DOC_ANCHOR = /\.md#[\p{L}\p{N}_-]+/gu;
const OUT_OF_SCOPE = [/\.md$/, /^\.claude\//, new RegExp(`^${BASELINE}$`)];
// The folder's own README holds the rules for contributors, and those stay Russian like the rest of docs/.
const PUBLIC_PAGE = /^docs\/public\/(?!README\.md$)[^/]+\.md$/;

export const inScope = (file) => PUBLIC_PAGE.test(file) || !OUT_OF_SCOPE.some((r) => r.test(file));

export const hasCyrillic = (line) => CYRILLIC.test(line.replace(DOC_ANCHOR, ".md"));

export function cyrillicLines(text) {
    if (text.includes("\0")) return 0;
    return text.split("\n").filter(hasCyrillic).length;
}

export function scan() {
    const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 1 << 28 })
        .split("\0")
        .filter((f) => f && inScope(f));
    const counts = {};
    for (const f of files) {
        let text;
        try {
            text = readFileSync(f, "utf8");
        } catch {
            continue; // deleted in the working tree but still in the index
        }
        const count = cyrillicLines(text);
        if (count > 0) counts[f] = count;
    }
    return counts;
}

function main() {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const counts = scan();
    if (process.argv.includes("--update")) {
        const next = lowered(baseline, counts);
        writeFileSync(BASELINE, `${JSON.stringify(next, null, 4)}\n`);
        const total = Object.values(next).reduce((a, b) => a + b, 0);
        console.log(`check-cyrillic: baseline lowered — ${Object.keys(next).length} files, ${total} lines`);
        return 0;
    }
    const { over, below } = compare(baseline, counts);
    for (const { file, count, allowed } of over) {
        console.error(`${file}: ${count} lines with Cyrillic, baseline ${allowed} — code, comments and strings are English`);
    }
    if (below.length > 0) {
        console.log(`check-cyrillic: ${below.length} files below baseline — \`npm run cyrillic-check -- --update\` lowers it`);
    }
    console.log(`check-cyrillic: ${Object.keys(counts).length} files with Cyrillic, ${over.length} over baseline`);
    return over.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
