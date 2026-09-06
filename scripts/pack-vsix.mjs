#!/usr/bin/env node
/**
 * Детерминированная упаковка каталога расширения в `.vsix` для магазина.
 *
 * `.vsix` — обычный zip с `extension/**` и заглушкой `extension.vsixmanifest`
 * (её ждёт формат, наш установщик читает только `extension/package.json`).
 * Детерминированность здесь не эстетика: запись реестра пинит артефакт по
 * `sha256`, и пересборка без изменений обязана давать те же байты — иначе
 * невозможно проверить, что опубликовано именно то, что лежит в репозитории.
 * Поэтому фиксируем время файлов и порядок записей, а не полагаемся на обход ФС.
 *
 * Использование:
 *   node scripts/pack-vsix.mjs <каталог-расширения> <выходной .vsix>
 *
 * Печатает id, версию, размер и sha256 — ровно то, что идёт в запись реестра.
 */

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

import yazl from "yazl";

/** Фиксированная mtime записей: любая «текущая дата» ломала бы воспроизводимость. */
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");

const VSIX_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata><Identity Language="en-US"/></Metadata>
</PackageManifest>
`;

/** Все файлы каталога, POSIX-пути относительно него, отсортированы кодпоинтно. */
function listFiles(root) {
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(path.relative(root, full).split(path.sep).join("/"));
        }
    };
    walk(root);
    // Сортировка своя, а не порядок readdir: он зависит от файловой системы.
    return out.sort();
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

const [sourceDir, outPath] = process.argv.slice(2);
if (sourceDir === undefined || outPath === undefined) {
    fail("Usage: node scripts/pack-vsix.mjs <extension-dir> <out.vsix>");
}

const manifestPath = path.join(sourceDir, "package.json");
if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) {
    fail(`Not an extension directory (no package.json): ${sourceDir}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (typeof manifest.publisher !== "string" || typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    fail(`${manifestPath}: publisher, name and version are required`);
}

const zip = new yazl.ZipFile();
for (const rel of listFiles(sourceDir)) {
    zip.addBuffer(readFileSync(path.join(sourceDir, rel)), `extension/${rel}`, { mtime: FIXED_MTIME });
}
zip.addBuffer(Buffer.from(VSIX_MANIFEST), "extension.vsixmanifest", { mtime: FIXED_MTIME });

mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
const out = createWriteStream(outPath);
out.on("close", () => {
    const bytes = readFileSync(outPath);
    const id = `${manifest.publisher}.${manifest.name}`;
    console.log(`id:      ${id}`);
    console.log(`version: ${manifest.version}`);
    console.log(`size:    ${bytes.byteLength}`);
    console.log(`sha256:  ${createHash("sha256").update(bytes).digest("hex")}`);
    console.log(`out:     ${path.resolve(outPath)}`);
});
zip.outputStream.pipe(out);
zip.end();
