#!/usr/bin/env node
/**
 * Гейт для правок «только комментарии» (чистка комментариев, docs/STYLE.md#комментарии):
 * сверяет каждый изменённый относительно базы файл и падает, если правка задела что-то
 * кроме комментариев. Код сравнивается напечатанным заново AST без комментариев — так
 * пробелы, переносы и вычищенные строки не мешают, а любая правка токена видна.
 * Служебные маркеры (Stryker, c8/v8, eslint, TODO, …) обязаны дожить в том же числе:
 * они — не пояснения, а инструкции инструментам и людям.
 *
 *   node scripts/check-comments-only.mjs [база=origin/main] [-- пути…]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const base = (sep < 0 ? args : args.slice(0, sep))[0] ?? "origin/main";
const only = sep < 0 ? [] : args.slice(sep + 1);

const CODE = /\.(?:[cm]?[jt]s|tsx)$/;
// Маркер — директива, а не упоминание: считается только в начале строки комментария
// (после `//`, `/*`, `*` и декора `──`). Иначе ужатие прозы «маркеры (Stryker, TODO, …)»
// или `` `/* v8 ignore */` `` в JSDoc роняет гейт, хотя ни одна директива не пропала.
const MARKERS = [
    /^Stryker (?:disable|restore)/,
    /^(?:[cv]8|istanbul) ignore/,
    /^eslint-(?:disable|enable)/,
    /^prettier-ignore/,
    /^@ts-(?:expect-error|ignore|nocheck)/,
    /^@deprecated/,
    /^@vitest-environment/,
    /^@diode:/,
    /^(?:TODO|FIXME|HACK|XXX)\b/,
];
const FILE_MARKERS = [/^\/\/\/ <reference/gm, /^#!/g];
const FROZEN = [/\/vscode\.d\.ts$/, /\/vscode-dts\//];

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const changed = git("diff", "--name-only", "--diff-filter=M", base, "--", ...only)
    .split("\n")
    .filter((f) => CODE.test(f));
const removed = git("diff", "--name-only", "--diff-filter=DR", base, "--", ...only)
    .split("\n")
    .filter(Boolean);

const printer = ts.createPrinter({ removeComments: true });
const kindOf = (path) =>
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
function codeOf(path, text) {
    return printer.printFile(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kindOf(path)));
}

// Обход через getChildren, а не forEachChild: тому не видны токены, и комментарий
// перед `}` пустого блока (`catch { /* c8 ignore next */ }`) потерялся бы.
function commentLines(path, text) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
    const seen = new Set();
    const lines = [];
    const take = (ranges) => {
        for (const r of ranges ?? []) {
            if (seen.has(r.pos)) continue;
            seen.add(r.pos);
            const body = text
                .slice(r.pos, r.end)
                .replace(/^\/[/*]/, "")
                .replace(/\*\/$/, "");
            for (const line of body.split("\n")) lines.push(line.replace(/^[\s*─—–-]*/, ""));
        }
    };
    const visit = (node) => {
        take(ts.getLeadingCommentRanges(text, node.getFullStart()));
        take(ts.getTrailingCommentRanges(text, node.getEnd()));
        for (const child of node.getChildren(sf)) visit(child);
    };
    visit(sf);
    return lines;
}

function markerCounts(path, text) {
    const lines = commentLines(path, text);
    return [
        ...MARKERS.map((re) => [re.source, lines.filter((l) => re.test(l)).length]),
        ...FILE_MARKERS.map((re) => [re.source, text.match(re)?.length ?? 0]),
    ];
}

const problems = [];
for (const f of removed) problems.push(`${f}: файл удалён/переименован — чистка комментариев так не делает`);
for (const f of changed) {
    const before = git("show", `${base}:${f}`);
    const after = readFileSync(f, "utf8");
    if (before.includes("//@diode:vendored") || FROZEN.some((r) => r.test(f))) {
        problems.push(`${f}: дословная копия upstream — руками не правится`);
        continue;
    }
    if (codeOf(f, before) !== codeOf(f, after)) problems.push(`${f}: изменён код, а не только комментарии`);
    const now = markerCounts(f, after);
    for (const [i, [marker, was]] of markerCounts(f, before).entries()) {
        if (was !== now[i][1]) problems.push(`${f}: маркер ${marker} — было ${was}, стало ${now[i][1]}`);
    }
}

for (const p of problems) console.error(p);
console.log(`check-comments-only: ${changed.length} файлов, ${problems.length} нарушений`);
process.exit(problems.length === 0 ? 0 : 1);
