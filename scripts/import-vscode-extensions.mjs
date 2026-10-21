#!/usr/bin/env node
/**
 * Import declarative language-basics extensions from microsoft/vscode
 * into `extensions/`.
 *
 * Repeatable: bump `VSCODE_TAG` and re-run; each target directory is wiped
 * before copying, so files removed upstream do not linger. The pinned tag is
 * recorded in `extensions/VSCODE_VERSION`.
 *
 * Only extensions without runtime code are imported. `git-base` declares a
 * `main`, but builtin extensions are never activated in the extension host —
 * its language contributions load fine, the code is stripped.
 *
 * Usage: node scripts/import-vscode-extensions.mjs [--keep-clone]
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VSCODE_TAG = "1.127.0";
const VSCODE_REPO = "https://github.com/microsoft/vscode.git";

const LANGUAGE_PACKS = [
    "bat",
    "clojure",
    "coffeescript",
    "cpp",
    "csharp",
    "css",
    "dart",
    "diff",
    "docker",
    "dotenv",
    "fsharp",
    "git-base",
    "go",
    "groovy",
    "handlebars",
    "hlsl",
    "html",
    "ini",
    "java",
    "javascript",
    "json",
    "julia",
    "latex",
    "less",
    "log",
    "lua",
    "make",
    "markdown-basics",
    "objective-c",
    "perl",
    "php",
    "powershell",
    "pug",
    "python",
    "r",
    "razor",
    "restructuredtext",
    "ruby",
    "rust",
    "scss",
    "shaderlab",
    "shellscript",
    "sql",
    "swift",
    "typescript-basics",
    "vb",
    "xml",
    "yaml",
];

/** Denylist, not allowlist: manifests reference icons and oddly-named config files, an allowlist would silently break packs. */
const STRIP_NAMES = new Set([
    "test",
    "build",
    "src",
    "out",
    "node_modules",
    ".vscode",
    "cgmanifest.json",
    ".vscodeignore",
    "yarn.lock",
    "package-lock.json",
    ".gitignore",
    ".npmrc",
]);
const STRIP_PATTERNS = [/\.md$/i, /\.mts$/i, /^tsconfig(\..+)?\.json$/];

/** @param {string} name */
function shouldStrip(name) {
    return STRIP_NAMES.has(name) || STRIP_PATTERNS.some((re) => re.test(name));
}

/** @param {string} dir */
function dirSize(dir) {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) total += dirSize(full);
        else if (entry.isFile()) total += statSync(full).size;
    }
    return total;
}

const repoRoot = resolve(import.meta.dirname, "..");
const builtinDir = resolve(repoRoot, "extensions");
const keepClone = process.argv.includes("--keep-clone");

const scratch = mkdtempSync(join(tmpdir(), "vscode-import-"));
const cloneDir = join(scratch, "vscode");
try {
    console.error(`[import] cloning microsoft/vscode@${VSCODE_TAG} (sparse, blobless) into ${cloneDir}`);
    execFileSync(
        "git",
        ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", VSCODE_TAG, VSCODE_REPO, cloneDir],
        { stdio: ["ignore", "ignore", "inherit"] },
    );
    execFileSync(
        "git",
        ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", ...LANGUAGE_PACKS.map((p) => `extensions/${p}`)],
        { stdio: ["ignore", "ignore", "inherit"] },
    );

    let imported = 0;
    let totalBytes = 0;
    for (const pack of LANGUAGE_PACKS) {
        const source = join(cloneDir, "extensions", pack);
        if (!existsSync(join(source, "package.json"))) {
            console.error(`[import] WARN: extensions/${pack} not found at tag ${VSCODE_TAG}, skipped`);
            continue;
        }
        const target = join(builtinDir, pack);
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        cpSync(source, target, {
            recursive: true,
            filter: (src) => !shouldStrip(src.split("/").at(-1) ?? ""),
        });
        const size = dirSize(target);
        totalBytes += size;
        imported++;
        console.error(`[import]   ${pack.padEnd(20)} ${(size / 1024).toFixed(1)} KB`);
    }

    writeFileSync(join(builtinDir, "VSCODE_VERSION"), `${VSCODE_TAG}\n`);
    console.error(
        `[import] done: ${imported}/${LANGUAGE_PACKS.length} packs, ${(totalBytes / 1024 / 1024).toFixed(1)} MB total, tag ${VSCODE_TAG}`,
    );
} finally {
    if (keepClone) console.error(`[import] clone kept at ${cloneDir}`);
    else rmSync(scratch, { recursive: true, force: true });
}
