import * as path from "node:path";

import { matchAnyGlob, matchGlob } from "../../../base/common/glob.ts";

/**
 * Directly on the subprocess disk rather than via RPC: the editor's main loop already starved
 * from the recursive walk, and `redhat.java` calls `findFiles` about ten times per activation.
 */

export interface IFindFilesEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/** Must answer rather than throw: a directory without permissions doesn't abort the search (upstream's ripgrep skips it). */
export interface IFindFilesScanner {
    readDirectory(absolutePath: string): Promise<readonly IFindFilesEntry[]>;
}

/** Safety net: `findFiles("**\/*.java")` on a home directory must not hold activation forever. */
export const DEFAULT_MAX_DIRECTORIES = 5000;

export interface IFindFilesRequest {
    /** Absolute path of the search root (the `GlobPattern` base). */
    readonly base: string;
    readonly include: string;
    /**
     * An empty string (sent by `redhat.java`) compiles to `^$` and matches
     * nothing, so no special case is needed.
     */
    readonly excludes: readonly string[];
    /** Upper bound on results; `undefined` or `Infinity` means unbounded. */
    readonly maxResults?: number;
}

export interface IFindFilesOptions {
    readonly maxDirectories?: number;
    readonly isCancelled?: () => boolean;
}

/**
 * Files only, posix paths relative to the base: `**\/build` doesn't return the build directory.
 * Breadth-first walk: with `maxResults: 1` (common for `redhat.java`) the
 * nearest match is found rather than the first one in depth.
 */
export async function findFiles(
    scanner: IFindFilesScanner,
    request: IFindFilesRequest,
    options: IFindFilesOptions = {},
): Promise<string[]> {
    const limit = request.maxResults ?? Number.POSITIVE_INFINITY;
    const found: string[] = [];
    if (limit <= 0) return found;

    const maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
    const isCancelled = (): boolean => options.isCancelled?.() === true;
    const excludes = request.excludes;
    const maxDepth = maxGlobDepth(request.include);

    let frontier: { absolutePath: string; relativePath: string }[] = [{ absolutePath: request.base, relativePath: "" }];
    let read = 0;
    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: typeof frontier = [];
        for (const dir of frontier) {
            if (isCancelled() || read >= maxDirectories) return found;
            read++;
            for (const entry of await scanner.readDirectory(dir.absolutePath)) {
                // Relative posix path from the base: that's how `matchGlob` anchors (`*` doesn't cross `/`).
                const relativePath = dir.relativePath === "" ? entry.name : `${dir.relativePath}/${entry.name}`;
                // `**\/node_modules` cuts off the directory itself, and the walk doesn't enter it;
                // `**\/node_modules/**` drops every file inside: same result, more expensive.
                if (matchAnyGlob(excludes, relativePath)) continue;
                if (entry.isDirectory) {
                    next.push({ absolutePath: path.join(dir.absolutePath, entry.name), relativePath });
                    continue;
                }
                if (!matchGlob(request.include, relativePath)) continue;
                found.push(relativePath);
                if (found.length >= limit) return found;
            }
        }
        frontier = next;
    }
    return found;
}

/**
 * A pattern without `**` fixes the segment count, so searching deeper is pointless. The estimate
 * is an upper bound: a `/` inside `{a/b,c}` overstates the depth, but an extra level is safer
 * than a missed match.
 */
function maxGlobDepth(glob: string): number {
    if (glob.includes("**")) return Number.POSITIVE_INFINITY;
    return glob.split("/").length - 1;
}
