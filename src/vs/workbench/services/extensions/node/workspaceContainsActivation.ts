import * as fs from "node:fs";
import * as path from "node:path";

import { CancellationTokenNone, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { matchGlob } from "../../../../base/common/glob.ts";
import type { IWorkspaceContainsPatterns } from "../common/activationEvents.ts";

export interface IWorkspaceDirectoryEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/** Обе операции отвечают, а не бросают: каталог без прав не должен ронять активацию всех расширений. */
export interface IWorkspaceScanner {
    exists(absolutePath: string): Promise<boolean>;
    /** Записи каталога; недоступный/исчезнувший каталог — пустой список. */
    readDirectory(absolutePath: string): Promise<readonly IWorkspaceDirectoryEntry[]>;
}

/** Дефолты `files.exclude` эталона: чужой `pom.xml` в зависимости — не признак проекта. */
export const DEFAULT_WORKSPACE_CONTAINS_EXCLUDES: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Бюджет каталогов на папку: без него `workspaceContains:**\/x` на домашнем каталоге держал бы старт. */
export const DEFAULT_MAX_DIRECTORIES = 5000;

export interface IWorkspaceContainsSearchOptions {
    readonly excludeDirectories?: ReadonlySet<string>;
    readonly maxDirectories?: number;
    readonly token?: ICancellationToken;
}

export interface IWorkspaceContainsResult {
    readonly pattern: string | null;
    /** `pattern === null` при `truncated` — «не нашли», а не «нет»: причину обязан сообщить вызывающий. */
    readonly truncated: boolean;
}

const NO_MATCH: IWorkspaceContainsResult = { pattern: null, truncated: false };

/** Сперва дешёвые `exists` по всем папкам, затем обход дерева — как в эталоне. */
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

/** В ширину: реальные паттерны мелкие (`*\/pom.xml`, `*.py`), совпадение лежит у корня. */
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
                // Относительный posix от папки воркспейса — так якорится `matchGlob` (`*` не переходит `/`).
                const relativePath = dir.relativePath === "" ? entry.name : `${dir.relativePath}/${entry.name}`;
                if (entry.isDirectory) {
                    if (!excludes.has(entry.name)) {
                        next.push({ absolutePath: path.join(dir.absolutePath, entry.name), relativePath });
                    }
                    continue;
                }
                // Каталоги против glob'ов не матчим: событие — про ФАЙЛ; каталог закрывает
                // паттерн без glob-символов через `exists`.
                const hit = globs.find((glob) => matchGlob(glob, relativePath));
                if (hit !== undefined) return { pattern: hit, truncated: false };
            }
        }
        frontier = next;
    }
    return NO_MATCH;
}

/**
 * Без `**` паттерн фиксирует число сегментов — глубже искать незачем. `/` внутри
 * `{a/b,c}` завышает оценку: лишний уровень безопаснее пропущенного совпадения.
 */
function maxGlobDepth(globs: readonly string[]): number {
    let depth = 0;
    for (const glob of globs) {
        if (glob.includes("**")) return Number.POSITIVE_INFINITY;
        depth = Math.max(depth, glob.split("/").length - 1);
    }
    return depth;
}

/** Симлинки на каталоги не раскрываются (`Dirent.isDirectory()` у них ложный) — обход не зацикливается. */
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
