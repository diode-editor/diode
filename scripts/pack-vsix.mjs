#!/usr/bin/env node
/**
 * Deterministic packing of an extension directory into a `.vsix` for the gallery.
 *
 * The format expects an `extension.vsixmanifest` stub; our installer reads only
 * `extension/package.json`. Determinism is not cosmetic: the registry entry pins the
 * artifact by `sha256`, and an unchanged rebuild must produce the same bytes.
 *
 * Usage:
 *   node scripts/pack-vsix.mjs <extension-dir> <out.vsix>
 *
 * Prints the id, version, size and sha256: exactly what goes into the registry entry.
 */

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

import yazl from "yazl";

const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");

const VSIX_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata><Identity Language="en-US"/></Metadata>
</PackageManifest>
`;

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
    // readdir order depends on the file system.
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
