// rg flags shared by Quick Open (`rg --files`) and the Search view (`rg --json`) —
// otherwise their file sets diverge. Flags follow upstream `getRgArgs`.

import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";

/**
 * Like upstream `anchorGlob`: rg matches a glob without `/` at any depth, while ours
 * (`isExcludedPath`, Explorer, watcher) match only from the root.
 */
export function anchorRgGlob(glob: string): string {
    return glob.startsWith("**") || glob.startsWith("/") ? glob : `/${glob}`;
}

/** The "files to exclude" field arrives already expanded (`foo` → `**\/foo`, `parseSearchFieldGlobs`). */
export function rgExcludeArgs(excludes: readonly string[]): string[] {
    const args: string[] = [];
    for (const glob of excludes) {
        // A trailing `/` means "directories only" to rg; we have no such notion, so trim it like upstream.
        const trimmed = glob.replace(/\/+$/, "");
        if (trimmed !== "") args.push("--glob", `!${anchorRgGlob(trimmed)}`);
    }
    return args;
}

/**
 * `--no-config`: the user's `RIPGREPRC_PATH` does not change the editor's file set;
 * `--no-require-git`: `.gitignore` is honored outside a git repository too.
 */
export function rgIgnoreFilesArgs(useIgnoreFiles: IUseIgnoreFiles): string[] {
    const args = ["--no-require-git", "--no-config"];
    if (!useIgnoreFiles.local) {
        args.push("--no-ignore");
        return args;
    }
    if (!useIgnoreFiles.parent) args.push("--no-ignore-parent");
    if (!useIgnoreFiles.global) args.push("--no-ignore-global");
    return args;
}

/**
 * `--hidden`: dotfiles are filtered by `files.exclude`/ignore files, not by the leading dot.
 * Symlinks are not followed: upstream `--follow` sits behind `search.followSymlinks`, which
 * we do not have. `includes` go before the excludes, as upstream: in rg the later glob wins,
 * so an include never resurrects an excluded subtree.
 */
export function buildRgFilesArgs(
    excludes: readonly string[],
    useIgnoreFiles: IUseIgnoreFiles,
    includes: readonly string[] = [],
): string[] {
    const includeArgs = includes.flatMap((glob) => ["--glob", anchorRgGlob(glob)]);
    return ["--files", "--hidden", ...includeArgs, ...rgExcludeArgs(excludes), ...rgIgnoreFilesArgs(useIgnoreFiles)];
}
