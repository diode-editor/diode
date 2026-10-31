/**
 * The `vscode-api-tests` sources at the pinned tag. They are never copied into the repository: the
 * tag's own text is extracted on every run. `.reference` is a sparse clone without `extensions/`,
 * so the directory comes through `git archive`, which lazily fetches the blobs a blobless clone lacks.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export const API_TESTS_DIR = "extensions/vscode-api-tests";

/** @param {string} repoRoot */
export function pinnedTag(repoRoot) {
    return readFileSync(path.join(repoRoot, "extensions", "VSCODE_VERSION"), "utf8").trim();
}

/** @param {string} repoRoot */
export function extractUpstreamApiTests(repoRoot, destination) {
    const tag = pinnedTag(repoRoot);
    const checkout = execFileSync(process.execPath, [path.join(repoRoot, "scripts", "vscode-ref.mjs")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
    }).trim();
    mkdirSync(destination, { recursive: true });
    let archive;
    try {
        archive = execFileSync("git", ["archive", "--format=tar", tag, API_TESTS_DIR], {
            cwd: checkout,
            maxBuffer: 256 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (error) {
        throw new Error(
            `Cannot read ${API_TESTS_DIR} at tag ${tag} from ${checkout}: ${String(error)}\n` +
                `If the checkout is on another tag, move it: node scripts/vscode-ref.mjs --update`,
            { cause: error },
        );
    }
    const tarPath = path.join(destination, "upstream.tar");
    writeFileSync(tarPath, archive);
    execFileSync("tar", ["-xf", tarPath, "-C", destination, "--strip-components=2"], { stdio: "inherit" });
    return destination;
}
