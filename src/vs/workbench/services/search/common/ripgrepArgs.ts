/**
 * Аргументы ripgrep, общие для двух поисков — по именам файлов (Quick Open,
 * `rg --files`) и по содержимому (Search view, `rg --json`): прежде всего
 * ignore-файлы. Один код на оба — иначе набор файлов, который видит Quick
 * Open, разъехался бы с тем, где ищет Search view (так и было, пока Quick Open
 * обходил ФС сам и `.gitignore` не знал).
 *
 * Флаги — ровно эталона: `getRgArgs` в `ripgrepFileSearch.ts` и
 * `ripgrepTextSearchEngine.ts`. Чистый модуль, без `node:`.
 */

import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";

/**
 * Якорит шаблон к корню поиска, как `anchorGlob` эталона. У rg шаблон без `/`
 * матчится на ЛЮБОЙ глубине (семантика gitignore), а у нас (`isExcludedPath`,
 * дерево Explorer'а, watcher) — только против пути от корня: `out` — только
 * `<корень>/out`, не `pkg/out`. Ведущий `/` возвращает rg ту же семантику;
 * `**`-шаблоны и так от корня.
 */
export function anchorRgGlob(glob: string): string {
    return glob.startsWith("**") || glob.startsWith("/") ? glob : `/${glob}`;
}

/**
 * `--glob !<g>` на каждый шаблон исключения (пустые пропускаются), якорёные.
 * Только для Quick Open: текстовый поиск передаёт шаблоны как есть — туда же
 * идёт поле «files to exclude», где `foo` значит «на любой глубине».
 */
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
 * Флаги ignore-файлов. `--no-config` — всегда: `RIPGREPRC_PATH` пользователя не
 * должен молча менять набор файлов редактора. `--no-require-git` — `.gitignore`
 * уважается и в папке, которая не git-репозиторий (без него rg читает
 * `.gitignore` только внутри репо).
 */
export function rgIgnoreFilesArgs(useIgnoreFiles: IUseIgnoreFiles): string[] {
    const args = ["--no-require-git", "--no-config"];
    if (!useIgnoreFiles.local) {
        // Ни `.gitignore`, ни `.ignore`, ни глобального, ни родительских.
        args.push("--no-ignore");
        return args;
    }
    if (!useIgnoreFiles.parent) args.push("--no-ignore-parent");
    if (!useIgnoreFiles.global) args.push("--no-ignore-global");
    return args;
}

/**
 * `rg --files` для индекса Quick Open: список файлов под cwd, пути
 * относительные. `--hidden` — dot-файлы ищутся (служебное режут
 * `files.exclude`/ignore-файлы, а не точка в имени). Симлинки не обходим (`--follow` эталона — за
 * `search.followSymlinks`, которой у нас нет): прежний обход их тоже пропускал.
 */
export function buildRgFilesArgs(excludes: readonly string[], useIgnoreFiles: IUseIgnoreFiles): string[] {
    return ["--files", "--hidden", ...rgExcludeArgs(excludes), ...rgIgnoreFilesArgs(useIgnoreFiles)];
}
