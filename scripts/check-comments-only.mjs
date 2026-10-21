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
const MARKERS = [
    /Stryker (?:disable|restore)/g,
    /[cv]8 ignore|istanbul ignore/g,
    /eslint-(?:disable|enable)/g,
    /prettier-ignore/g,
    /@ts-(?:expect-error|ignore|nocheck)/g,
    /@deprecated/g,
    /@vitest-environment/g,
    /@diode:/g,
    /(?<!\/)\b(?:TODO|FIXME|HACK|XXX)\b(?!\/)/g,
    /^\/\/\/ <reference/gm,
    /^#!/g,
];
const FROZEN = [/\/vscode\.d\.ts$/, /\/vscode-dts\//];

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
const changed = git("diff", "--name-only", "--diff-filter=M", base, "--", ...only)
    .split("\n")
    .filter((f) => CODE.test(f));
const removed = git("diff", "--name-only", "--diff-filter=DR", base, "--", ...only)
    .split("\n")
    .filter(Boolean);

const printer = ts.createPrinter({ removeComments: true });
function codeOf(path, text) {
    const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    return printer.printFile(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind));
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
    for (const re of MARKERS) {
        const was = before.match(re)?.length ?? 0;
        const now = after.match(re)?.length ?? 0;
        if (was !== now) problems.push(`${f}: маркер ${re.source} — было ${was}, стало ${now}`);
    }
}

for (const p of problems) console.error(p);
console.log(`check-comments-only: ${changed.length} файлов, ${problems.length} нарушений`);
process.exit(problems.length === 0 ? 0 : 1);
