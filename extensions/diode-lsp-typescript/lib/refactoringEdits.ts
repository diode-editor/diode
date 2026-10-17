import { fileURLToPath } from "node:url";

import type {
    ApplyWorkspaceEditParams,
    ApplyWorkspaceEditResult,
    CreateFile,
    TextDocumentEdit,
} from "vscode-languageclient/node";

/**
 * Правка рефакторинга («Move to a new file», «Extract to …») — в форме
 * эталона. Чистая логика (без vscode API) — покрывается юнитами; связку с
 * клиентом делает `main.ts`.
 *
 * Эталонное `typescript-language-features` (`refactor.ts`) применяет правку
 * рефакторинга так:
 * - каждому файлу правки — `WorkspaceEdit.createFile(uri, { ignoreIfExists:
 *   true })` перед вставкой текста: новый файл рождается этим же edit'ом, и
 *   Ctrl+Z убирает его вместе со вставкой;
 * - `workspace.applyEdit(edit, { isRefactoring: true })`: затронутые файлы
 *   сохраняются по `files.refactoring.autoSave`.
 *
 * Стоковый `typescript-language-server` в команде
 * `_typescript.applyRefactoring` создаёт новый файл САМ (`fs.ensureFile`) и
 * только потом шлёт `workspace/applyEdit` с голыми `changes`: редактор видит
 * правку уже существующего пустого файла (после отмены пустой файл остаётся
 * на диске), а `vscode-languageclient` применяет её без `isRefactoring`.
 * Клиент возвращает эталонную форму: файл, появившийся пустым, пока шла
 * команда рефакторинга, удаляется и приезжает в edit созданием, а сам edit
 * применяется как рефакторинг.
 */

/** Команда сервера, применяющая рефакторинг (`Commands.APPLY_REFACTORING`). */
export const APPLY_REFACTORING_COMMAND = "_typescript.applyRefactoring";

/**
 * Запас на грубые часы файловой системы: время создания ядро берёт из
 * «грубых» часов, и оно отстаёт от `Date.now()` на тик планировщика.
 */
const CLOCK_SLACK_MS = 1_000;

/** Что клиенту нужно знать о файле на диске. */
export interface FileStat {
    readonly size: number;
    /** Время создания; `0` — файловая система его не хранит. */
    readonly birthtimeMs: number;
    readonly ctimeMs: number;
}

export interface RefactoringEditsHost {
    now(): number;
    /** `null` — файла нет. */
    stat(filePath: string): Promise<FileStat | null>;
    unlink(filePath: string): Promise<void>;
    /** Возвращает пустой файл на место, если edit не применился. */
    writeEmpty(filePath: string): Promise<void>;
    /** Открыт ли документ (`uri.toString()`) — открытый файл существовал до команды. */
    isOpen(uri: string): boolean;
    /** `workspace.applyEdit(edit, { isRefactoring: true })` над LSP-правкой. */
    applyRefactoringEdit(params: ApplyWorkspaceEditParams): Promise<boolean>;
}

type ExecuteCommandNext = (command: string, args: unknown[]) => unknown;
/** Обработчик клиента дальше по цепочке (правка не рефакторинга). */
type ApplyEditNext<R> = (params: ApplyWorkspaceEditParams) => R | PromiseLike<R>;

/**
 * Middleware клиента: `executeCommand` отмечает окно команды рефакторинга,
 * `handleApplyEdit` применяет пришедшую в этом окне правку в форме эталона.
 */
export function createRefactoringEditsMiddleware(host: RefactoringEditsHost): {
    executeCommand(command: string, args: unknown[], next: ExecuteCommandNext): Promise<unknown>;
    handleApplyEdit<R>(params: ApplyWorkspaceEditParams, next: ApplyEditNext<R>): Promise<R | ApplyWorkspaceEditResult>;
} {
    /** Старты идущих команд рефакторинга; окно — от самого раннего. */
    const running: number[] = [];

    return {
        async executeCommand(command, args, next) {
            if (command !== APPLY_REFACTORING_COMMAND) return next(command, args);
            const startedAt = host.now();
            running.push(startedAt);
            try {
                return await next(command, args);
            } finally {
                running.splice(running.indexOf(startedAt), 1);
            }
        },

        async handleApplyEdit(params, next) {
            if (running.length === 0) return next(params);
            const since = Math.min(...running) - CLOCK_SLACK_MS;
            const created: string[] = [];
            // Сервер шлёт `changes`; `documentChanges` (уже с созданиями, если
            // они нужны) оставляем как есть.
            if (params.edit.documentChanges === undefined) {
                for (const uri of Object.keys(params.edit.changes ?? {})) {
                    if (await isFreshEmptyFile(host, uri, since)) created.push(uri);
                }
            }
            for (const uri of created) await host.unlink(fileURLToPath(uri));
            const applied = await host.applyRefactoringEdit(
                created.length === 0 ? params : withCreatedFiles(params, created),
            );
            // Не применилось — сервер рассчитывает на свой файл: вернём его.
            if (!applied) for (const uri of created) await host.writeEmpty(fileURLToPath(uri));
            return { applied };
        },
    };
}

/** Пустой файл, созданный не раньше `since` и не открытый в редакторе. */
async function isFreshEmptyFile(host: RefactoringEditsHost, uri: string, since: number): Promise<boolean> {
    if (!uri.startsWith("file:") || host.isOpen(uri)) return false;
    const stat = await host.stat(fileURLToPath(uri));
    if (stat?.size !== 0) return false;
    const createdAt = stat.birthtimeMs === 0 ? stat.ctimeMs : stat.birthtimeMs;
    return createdAt >= since;
}

/**
 * `changes` → `documentChanges` в том же порядке ресурсов; перед правками
 * каждого созданного файла — его создание.
 */
export function withCreatedFiles(
    params: ApplyWorkspaceEditParams,
    created: readonly string[],
): ApplyWorkspaceEditParams {
    const documentChanges: (TextDocumentEdit | CreateFile)[] = [];
    for (const [uri, edits] of Object.entries(params.edit.changes ?? {})) {
        if (created.includes(uri)) documentChanges.push({ kind: "create", uri });
        documentChanges.push({ textDocument: { uri, version: null }, edits });
    }
    const annotations = params.edit.changeAnnotations;
    return { ...params, edit: { documentChanges, ...(annotations ? { changeAnnotations: annotations } : {}) } };
}
