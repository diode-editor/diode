#!/usr/bin/env node
/**
 * Upstream to compare against: microsoft/vscode sources at the tag from `extensions/VSCODE_VERSION`.
 *
 *   node scripts/vscode-ref.mjs            print the upstream path (downloads it once if missing)
 *   node scripts/vscode-ref.mjs --update   move an existing clone to the current tag
 *
 * An existing clone is looked up first (DIODE_VSCODE_REF, sibling directories), otherwise
 * a blobless + sparse clone goes to `.reference/` (in `.gitignore`).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: import.meta.dirname }).trim();
const TAG = readFileSync(path.join(repoRoot, "extensions", "VSCODE_VERSION"), "utf8").trim();
const REMOTE = "https://github.com/microsoft/vscode.git";
const fallbackDir = path.join(repoRoot, ".reference", `vscode-${TAG}`);

// The one named by a human goes first.
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

/** A shallow clone may lack the exact tag: then the version comes from package.json. */
function versionOf(dir) {
    try {
        return git(["describe", "--tags", "--exact-match"], dir);
    } catch {
        try {
            return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version ?? "unknown";
        } catch {
            return "unknown";
        }
    }
}

function clone(dir) {
    console.error(`No vscode ${TAG} upstream: downloading to ${dir} (blobless, sparse, src/ only; once).`);
    mkdirSync(path.dirname(dir), { recursive: true });
    git(["clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "--branch", TAG, REMOTE, dir], repoRoot);
    git(["sparse-checkout", "set", "src"], dir);
    git(["checkout"], dir);
}

const update = process.argv.includes("--update");
let found = candidates.find(isCheckout);

if (found && update) {
    console.error(`Moving ${found} to tag ${TAG}…`);
    git(["fetch", "--depth", "1", "origin", `refs/tags/${TAG}:refs/tags/${TAG}`], found);
    git(["checkout", TAG], found);
}

if (!found) {
    clone(fallbackDir);
    found = fallbackDir;
}

const version = versionOf(found);
if (!version.includes(TAG)) {
    console.error(`Warning: the upstream in ${found} is version ${version}, but we are pinned to ${TAG}. Allow for that when comparing (--update moves the clone to the right tag).`);
}
console.log(found);
