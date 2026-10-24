import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { CancellationTokenNone, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { matchGlob } from "../../../../base/common/glob.ts";
import { GuardedChildProcess, splitLines } from "../../../../base/node/childProcessGuard.ts";
import {
    type IExcludeConfigReader,
    readUseIgnoreFiles,
    searchExcludeGlobs,
} from "../../../common/configuration/excludeSettings.ts";
import { buildRgFilesArgs } from "../../search/common/ripgrepArgs.ts";
import { loadRipgrepPath } from "../../search/node/loadRipgrep.ts";
import type { IWorkspaceContainsPatterns } from "../common/activationEvents.ts";

/**
 * `exists` answers rather than throws: a directory without permissions must not break activation of all
 * extensions.
 */
export interface IWorkspaceScanner {
    exists(absolutePath: string): Promise<boolean>;
    /**
     * Relative posix path of the first file under `folder` matching any of `globs`, `null` — none. A cancelled
     * token ends the search at once with `null`; the search itself must not outlive it.
     */
    findFile(folder: string, globs: readonly string[], token: ICancellationToken): Promise<string | null>;
}

/** Cheap `exists` over all folders first, then one glob search per folder, as upstream. `null` — no match. */
export async function matchWorkspaceContains(
    scanner: IWorkspaceScanner,
    folders: readonly string[],
    patterns: IWorkspaceContainsPatterns,
    token: ICancellationToken = CancellationTokenNone,
): Promise<string | null> {
    for (const folder of folders) {
        for (const pattern of patterns.paths) {
            if (token.isCancellationRequested) return null;
            if (await scanner.exists(path.join(folder, pattern))) return pattern;
        }
    }
    if (patterns.globs.length === 0) return null;
    for (const folder of folders) {
        if (token.isCancellationRequested) return null;
        const found = await scanner.findFile(folder, patterns.globs, token);
        if (found !== null) return matchedGlob(patterns.globs, found);
    }
    return null;
}

/**
 * The reason names the glob that fits the found path. rg's dialect may differ from ours on exotic patterns;
 * the file was found by one of the globs anyway, so the first declared one stands in.
 */
function matchedGlob(globs: readonly string[], relativePath: string): string {
    return globs.find((glob) => matchGlob(glob, relativePath)) ?? globs[0];
}

const NO_SETTINGS: IExcludeConfigReader = { get: () => undefined };

/**
 * Globs go to an rg subprocess, as upstream `checkGlobFileExists` (a file search with `exists`): a `readdir`
 * on a slow FUSE/network mount would sit in the libuv pool, and `process.exit` waits for that pool. Flags and
 * exclusions are Quick Open's (`buildRgFilesArgs`, `search.exclude` + `files.exclude`, ignore files), so the
 * file sets don't diverge. Settings are read per search: the next pass sees a changed value. Without `config`
 * nothing is excluded but ignore files.
 */
export function createRipgrepWorkspaceScanner(
    config: IExcludeConfigReader = NO_SETTINGS,
    ripgrepPath: () => string = loadRipgrepPath,
): IWorkspaceScanner {
    return {
        exists: async (absolutePath: string): Promise<boolean> => {
            try {
                await fs.promises.stat(absolutePath);
                return true;
            } catch {
                return false;
            }
        },
        // `async`: an rg path that fails to resolve rejects like any other failure instead of throwing.
        findFile: async (folder, globs, token) => {
            if (token.isCancellationRequested) return null;
            const args = buildRgFilesArgs(searchExcludeGlobs(config), readUseIgnoreFiles(config), globs);
            // The folder is `cwd`, not a shell word: spaces and unicode in the path need no quoting.
            const child = spawn(ripgrepPath(), args, { cwd: folder, stdio: ["ignore", "pipe", "ignore"] });
            // Stryker disable next-line StringLiteral,ObjectLiteral: no logger here — the label never reaches a log; `waitForStdio` only orders `close` after the last line, which `finish` already ignores
            const guard = new GuardedChildProcess(child, { label: "rg", waitForStdio: true });
            return new Promise<string | null>((resolve, reject) => {
                let done = false;
                const finish = (found: string | null, error?: unknown): void => {
                    if (done) return;
                    done = true;
                    cancellation.dispose();
                    // SIGKILL: the first line is the answer, the rest of the walk is waste.
                    guard.dispose();
                    if (error === undefined) resolve(found);
                    // A ChildProcess `error` event always carries an Error.
                    else reject(error as Error);
                };
                const cancellation = token.onCancellationRequested(() => {
                    finish(null);
                });
                splitLines(child.stdout, (line) => {
                    // Stryker disable next-line ConditionalExpression: rg never prints an empty path; the guard is for a stray blank line only
                    if (line !== "") finish(line);
                });
                // Exit codes 1 (nothing) and 2 (some directories unreadable) aren't failures, as in
                // `FileSearchService`. A failed spawn (no rg, no folder) is: the extension stays inactive with a reason.
                guard.onDidEnd((end) => {
                    finish(null, end.error);
                });
            });
        },
    };
}
