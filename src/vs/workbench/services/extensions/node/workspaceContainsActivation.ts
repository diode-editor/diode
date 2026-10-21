import * as fs from "node:fs";
import * as path from "node:path";

import { CancellationTokenNone, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { matchGlob } from "../../../../base/common/glob.ts";
import type { IWorkspaceContainsPatterns } from "../common/activationEvents.ts";

export interface IWorkspaceDirectoryEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/**
 * Both operations answer rather than throw: a directory without permissions must not break activation of all
 * extensions.
 */
export interface IWorkspaceScanner {
    exists(absolutePath: string): Promise<boolean>;
    /** Directory entries; an inaccessible or vanished directory yields an empty list. */
    readDirectory(absolutePath: string): Promise<readonly IWorkspaceDirectoryEntry[]>;
}

/** Upstream `files.exclude` defaults: a `pom.xml` inside a dependency doesn't mark the project. */
export const DEFAULT_WORKSPACE_CONTAINS_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Directory budget per folder: without it `workspaceContains:**\/x` on a home directory would hold up startup. */
export const DEFAULT_MAX_DIRECTORIES = 5000;

export interface IWorkspaceContainsSearchOptions {
    readonly excludeDirectories?: ReadonlySet<string>;
    readonly maxDirectories?: number;
    readonly token?: ICancellationToken;
}

export interface IWorkspaceContainsResult {
    readonly pattern: string | null;
    /** `pattern === null` with `truncated` means "not found", not "absent": the caller must report why. */
    readonly truncated: boolean;
}

const NO_MATCH: IWorkspaceContainsResult = { pattern: null, truncated: false };

/** Cheap `exists` over all folders first, then the tree walk, as upstream. */
export async function matchWorkspaceContains(
    scanner: IWorkspaceScanner,
    folders: readonly string[],
    patterns: IWorkspaceContainsPatterns,
    options: IWorkspaceContainsSearchOptions = {},
): Promise<IWorkspaceContainsResult> {
    const token = options.token ?? CancellationTokenNone;
    for (const folder of folders) {
        for (const pattern of patterns.paths) {
            if (token.isCancellationRequested) return { pattern: null, truncated: true };
            if (await scanner.exists(path.join(folder, pattern))) return { pattern, truncated: false };
        }
    }
    if (patterns.globs.length === 0) return NO_MATCH;
    let truncated = false;
    for (const folder of folders) {
        const result = await searchGlobs(scanner, folder, patterns.globs, options);
        if (result.pattern !== null) return result;
        truncated = truncated || result.truncated;
    }
    return { pattern: null, truncated };
}

/** Breadth-first: real patterns are shallow (`*\/pom.xml`, `*.py`), the match sits near the root. */
async function searchGlobs(
    scanner: IWorkspaceScanner,
    root: string,
    globs: readonly string[],
    options: IWorkspaceContainsSearchOptions,
): Promise<IWorkspaceContainsResult> {
    const excludes = options.excludeDirectories ?? DEFAULT_WORKSPACE_CONTAINS_EXCLUDES;
    const maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
    const token = options.token ?? CancellationTokenNone;
    const maxDepth = maxGlobDepth(globs);

    let frontier: { absolutePath: string; relativePath: string }[] = [{ absolutePath: root, relativePath: "" }];
    let read = 0;
    for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
        const next: typeof frontier = [];
        for (const dir of frontier) {
            if (token.isCancellationRequested) return { pattern: null, truncated: true };
            if (read >= maxDirectories) return { pattern: null, truncated: true };
            read++;
            for (const entry of await scanner.readDirectory(dir.absolutePath)) {
                // Relative posix path from the workspace folder, which is how `matchGlob` anchors (`*` doesn't
                // cross `/`).
                const relativePath = dir.relativePath === "" ? entry.name : `${dir.relativePath}/${entry.name}`;
                if (entry.isDirectory) {
                    if (!excludes.has(entry.name)) {
                        next.push({ absolutePath: path.join(dir.absolutePath, entry.name), relativePath });
                    }
                    continue;
                }
                // Directories aren't matched against globs: the event is about a FILE; a directory is covered
                // by a pattern without glob characters via `exists`.
                const hit = globs.find((glob) => matchGlob(glob, relativePath));
                if (hit !== undefined) return { pattern: hit, truncated: false };
            }
        }
        frontier = next;
    }
    return NO_MATCH;
}

/**
 * Without `**` a pattern fixes the segment count, so there's no point searching deeper. `/` inside
 * `{a/b,c}` overestimates: an extra level is safer than a missed match.
 */
function maxGlobDepth(globs: readonly string[]): number {
    let depth = 0;
    for (const glob of globs) {
        if (glob.includes("**")) return Number.POSITIVE_INFINITY;
        depth = Math.max(depth, glob.split("/").length - 1);
    }
    return depth;
}

/** Symlinks to directories aren't followed (`Dirent.isDirectory()` is false for them), so the walk doesn't loop. */
export function createNodeWorkspaceScanner(): IWorkspaceScanner {
    return {
        exists: async (absolutePath: string): Promise<boolean> => {
            try {
                await fs.promises.stat(absolutePath);
                return true;
            } catch {
                return false;
            }
        },
        readDirectory: async (absolutePath: string): Promise<readonly IWorkspaceDirectoryEntry[]> => {
            try {
                const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });
                return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
            } catch {
                return [];
            }
        },
    };
}
