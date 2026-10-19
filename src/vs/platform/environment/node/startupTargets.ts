/**
 * Что редактор открывает на старте: папка воркспейса (или файл воркспейса
 * `.code-workspace`), файлы и (при `--diff`) пара сторон диффа. Отдельно от {@link parseCliArgs}, потому что решение
 * зависит от диска (директория это или файл), и отдельно от `main.ts`, потому
 * что тот исключён из покрытия — здесь логика тестируется юнитом.
 *
 * Пустой набор позиционных — законный вход: получается пустое окно (папка не
 * открывается, текущий каталог не трогается).
 */

import * as path from "node:path";

import { splitFileQuery } from "../../../base/common/lineColumnQuery.ts";
import { hasWorkspaceFileExtension, type IWorkspaceFileContents } from "../../workspace/common/workspaceFile.ts";

import type { ICliArgs } from "./cliArgs.ts";
import { CliArgsError } from "./cliArgs.ts";

/** Файл для открытия; `line`/`column` — 1-based, как их набирает человек. */
export interface IStartupFile {
    readonly path: string;
    readonly line?: number;
    readonly column?: number;
}

/** Открытый на старте файл воркспейса: путь и разобранное содержимое (`loadWorkspaceFile`). */
export interface IStartupWorkspace {
    readonly file: string;
    readonly contents: IWorkspaceFileContents;
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
    /**
     * Файл воркспейса `*.code-workspace` — первый позиционный, если это не
     * каталог и расширение совпадает (`diode web.code-workspace`, как `code
     * web.code-workspace`). Тогда {@link folder} не задана: папку называет сам
     * файл, его читает и разбирает `loadWorkspaceFile` (`main.ts`).
     */
    readonly workspaceFile: string | undefined;
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
 * @param logicalCwd каталог, от которого считается путь файла воркспейса
 *   ({@link logicalWorkingDirectory}); остальные позиционные — от `process.cwd()`
 */
export function resolveStartupTargets(
    cli: ICliArgs,
    isDirectory: (absolutePath: string) => boolean,
    logicalCwd: string = process.cwd(),
): IStartupTargets {
    if (cli.diff) {
        // Количество сторон уже проверено парсером; здесь просто резолвим пути.
        const [original, modified] = cli.positional.map((p) => path.resolve(p));
        return { folder: undefined, workspaceFile: undefined, files: [], diff: { original, modified } };
    }

    const parsed = cli.positional.map((raw) => parsePositional(raw, cli.goto, process.cwd()));
    // Папкой становится ТОЛЬКО первый позиционный: `diode file.ts src/` — это
    // файл в окне без воркспейса, как и в VS Code.
    const first = parsed.at(0);
    const folder = first !== undefined && isDirectory(first.path) ? first.path : undefined;
    // Файл воркспейса — тоже только первым и только по расширению: `diode a.ts
    // web.code-workspace` открывает его как обычный файл. Путь — от логического
    // cwd и без разворота симлинков: относительные `folders` файла считаются от
    // каталога, который назвал человек, а не от того, куда ведёт симлинк.
    const isWorkspaceFile = first !== undefined && folder === undefined && hasWorkspaceFileExtension(first.path);
    const workspaceFile = isWorkspaceFile ? parsePositional(cli.positional[0], cli.goto, logicalCwd).path : undefined;
    const files = parsed.filter((entry) => !isDirectory(entry.path) && entry !== (isWorkspaceFile ? first : undefined));
    return { folder, workspaceFile, files, diff: undefined };
}

/**
 * Позиционный аргумент → абсолютный путь плюс позиция. Суффикс `:line:column`
 * снимается только в режиме `--goto`: без него двоеточие — обычный символ в
 * имени файла, и отрезать его молча нельзя.
 */
function parsePositional(raw: string, gotoMode: boolean, cwd: string): IStartupFile {
    if (!gotoMode) return { path: path.resolve(cwd, raw) };

    const { filePart, goto } = splitFileQuery(raw);
    if (filePart.length === 0) {
        throw new CliArgsError(`--goto expects file[:line[:column]], got: ${raw}`);
    }
    const resolved = path.resolve(cwd, filePart);
    if (goto === null) return { path: resolved };
    return { path: resolved, line: goto.line, ...(goto.column !== undefined ? { column: goto.column } : {}) };
}

/**
 * Текущий каталог так, как его видит оболочка (`pwd -L`): `$PWD`, если он
 * абсолютный и ведёт туда же, что и `process.cwd()`. Node отдаёт cwd уже с
 * развёрнутыми симлинками (`getcwd(3)`), и `diode web.code-workspace` из
 * `~/link` иначе считал бы папки файла от цели ссылки. `$PWD` устарел
 * (родитель сменил каталог без него) или не задан — физический cwd.
 *
 * @param sameDirectory порт к FS — оба пути ведут в один каталог (dev + inode)
 */
export function logicalWorkingDirectory(
    pwd: string | undefined,
    physicalCwd: string,
    sameDirectory: (a: string, b: string) => boolean,
): string {
    if (pwd === undefined || !path.isAbsolute(pwd)) return physicalCwd;
    const normalized = path.resolve(pwd);
    return sameDirectory(normalized, physicalCwd) ? normalized : physicalCwd;
}
