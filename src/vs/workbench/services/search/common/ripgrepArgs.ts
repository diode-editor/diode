// Общие флаги rg для Quick Open (`rg --files`) и Search view (`rg --json`) — иначе их
// наборы файлов разъедутся. Флаги — как `getRgArgs` эталона.

import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";

/**
 * Как `anchorGlob` эталона: у rg шаблон без `/` матчится на любой глубине, а у нас
 * (`isExcludedPath`, Explorer, watcher) — только от корня.
 */
export function anchorRgGlob(glob: string): string {
    return glob.startsWith("**") || glob.startsWith("/") ? glob : `/${glob}`;
}

/** Поле «files to exclude» приходит уже развёрнутым (`foo` → `**\/foo`, `parseSearchFieldGlobs`). */
export function rgExcludeArgs(excludes: readonly string[]): string[] {
    const args: string[] = [];
    for (const glob of excludes) {
        // Хвостовой `/` у rg значит «только каталог», у нас его нет — срезаем, как эталон.
        const trimmed = glob.replace(/\/+$/, "");
        if (trimmed !== "") args.push("--glob", `!${anchorRgGlob(trimmed)}`);
    }
    return args;
}

/**
 * `--no-config`: `RIPGREPRC_PATH` пользователя не меняет набор файлов редактора;
 * `--no-require-git`: `.gitignore` уважается и вне git-репозитория.
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
 * `--hidden`: dot-файлы режут `files.exclude`/ignore-файлы, а не точка в имени. Симлинки
 * не обходим: `--follow` эталона — за `search.followSymlinks`, которой у нас нет.
 */
export function buildRgFilesArgs(excludes: readonly string[], useIgnoreFiles: IUseIgnoreFiles): string[] {
    return ["--files", "--hidden", ...rgExcludeArgs(excludes), ...rgIgnoreFilesArgs(useIgnoreFiles)];
}
