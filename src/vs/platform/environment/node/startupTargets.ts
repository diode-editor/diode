/**
 * Что редактор открывает на старте: папка воркспейса, файлы и (при `--diff`)
 * пара сторон диффа. Отдельно от {@link parseCliArgs}, потому что решение
 * зависит от диска (директория это или файл), и отдельно от `main.ts`, потому
 * что тот исключён из покрытия — здесь логика тестируется юнитом.
 *
 * Пустой набор позиционных — законный вход: получается пустое окно (папка не
 * открывается, текущий каталог не трогается).
 */

import * as path from "node:path";

import { splitFileQuery } from "../../../base/common/lineColumnQuery.ts";

import type { ICliArgs } from "./cliArgs.ts";
import { CliArgsError } from "./cliArgs.ts";

/** Файл для открытия; `line`/`column` — 1-based, как их набирает человек. */
export interface IStartupFile {
    readonly path: string;
    readonly line?: number;
    readonly column?: number;
}

/** Стороны дифф-вкладки для `--diff <a> <b>`. */
export interface IStartupDiff {
    readonly original: string;
    readonly modified: string;
}

export interface IStartupTargets {
    /**
     * Папка воркспейса — первый позиционный, если он директория. `undefined` —
     * окно без воркспейса: ни Explorer-корня, ни индекса файлов, ни
     * workspaceFolders у расширений.
     */
    readonly folder: string | undefined;
    /** Файлы, названные явно. Перебивают сохранённую сессию (как `code file.ts`). */
    readonly files: readonly IStartupFile[];
    /** Пара диффа; задана только в режиме `--diff`. */
    readonly diff: IStartupDiff | undefined;
}

/**
 * Резолвит цели старта из разобранных аргументов.
 *
 * @param cli результат {@link parseCliArgs}
 * @param isDirectory порт к FS — «этот абсолютный путь существует и это папка»
 */
export function resolveStartupTargets(cli: ICliArgs, isDirectory: (absolutePath: string) => boolean): IStartupTargets {
    if (cli.diff) {
        // Количество сторон уже проверено парсером; здесь просто резолвим пути.
        const [original, modified] = cli.positional.map((p) => path.resolve(p));
        return { folder: undefined, files: [], diff: { original, modified } };
    }

    const parsed = cli.positional.map((raw) => parsePositional(raw, cli.goto));
    // Папкой становится ТОЛЬКО первый позиционный: `diode file.ts src/` — это
    // файл в окне без воркспейса, как и в VS Code.
    const first = parsed.at(0);
    const folder = first !== undefined && isDirectory(first.path) ? first.path : undefined;
    const files = parsed.filter((entry) => !isDirectory(entry.path));
    return { folder, files, diff: undefined };
}

/**
 * Позиционный аргумент → абсолютный путь плюс позиция. Суффикс `:line:column`
 * снимается только в режиме `--goto`: без него двоеточие — обычный символ в
 * имени файла, и отрезать его молча нельзя.
 */
function parsePositional(raw: string, gotoMode: boolean): IStartupFile {
    if (!gotoMode) return { path: path.resolve(raw) };

    const { filePart, goto } = splitFileQuery(raw);
    if (filePart.length === 0) {
        throw new CliArgsError(`--goto expects file[:line[:column]], got: ${raw}`);
    }
    const resolved = path.resolve(filePart);
    if (goto === null) return { path: resolved };
    return { path: resolved, line: goto.line, ...(goto.column !== undefined ? { column: goto.column } : {}) };
}
