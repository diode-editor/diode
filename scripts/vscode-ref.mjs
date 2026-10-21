#!/usr/bin/env node
/**
 * Эталон для сверки: исходники microsoft/vscode тега из `extensions/VSCODE_VERSION`.
 *
 *   node scripts/vscode-ref.mjs            путь к эталону (скачает один раз, если его нет)
 *   node scripts/vscode-ref.mjs --update   перевести имеющийся клон на текущий тег
 *
 * Сначала ищется готовый клон (DIODE_VSCODE_REF, соседние каталоги), иначе качается
 * blobless + sparse в `.reference/` (в `.gitignore`).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: import.meta.dirname }).trim();
const TAG = readFileSync(path.join(repoRoot, "extensions", "VSCODE_VERSION"), "utf8").trim();
const REMOTE = "https://github.com/microsoft/vscode.git";
const fallbackDir = path.join(repoRoot, ".reference", `vscode-${TAG}`);

// Названное человеком — первым.
const candidates = [
    process.env.DIODE_VSCODE_REF,
    "/workspaces/vscode",
    "/workspaces/vscode-ref",
    path.resolve(repoRoot, "..", "vscode"),
    path.join(os.homedir(), "vscode"),
    fallbackDir,
].filter(Boolean);

const isCheckout = (dir) => existsSync(path.join(dir, "src", "vs"));

const git = (args, cwd) => execFileSync("git", args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }).trim();

/** У shallow-клона точного тега может не быть — тогда версия из package.json. */
function versionOf(dir) {
    try {
        return git(["describe", "--tags", "--exact-match"], dir);
    } catch {
        try {
            return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version ?? "неизвестно";
        } catch {
            return "неизвестно";
        }
    }
}

function clone(dir) {
    console.error(`Эталона vscode ${TAG} нет — качаю в ${dir} (blobless, sparse, только src/; один раз).`);
    mkdirSync(path.dirname(dir), { recursive: true });
    git(["clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "--branch", TAG, REMOTE, dir], repoRoot);
    git(["sparse-checkout", "set", "src"], dir);
    git(["checkout"], dir);
}

const update = process.argv.includes("--update");
let found = candidates.find(isCheckout);

if (found && update) {
    console.error(`Перевожу ${found} на тег ${TAG}…`);
    git(["fetch", "--depth", "1", "origin", `refs/tags/${TAG}:refs/tags/${TAG}`], found);
    git(["checkout", TAG], found);
}

if (!found) {
    clone(fallbackDir);
    found = fallbackDir;
}

const version = versionOf(found);
if (!version.includes(TAG)) {
    console.error(`Внимание: эталон в ${found} — версии ${version}, а мы запиннены к ${TAG}. Сверяй с поправкой на это (--update переведёт клон на нужный тег).`);
}
console.log(found);
