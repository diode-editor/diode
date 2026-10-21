import { fileURLToPath } from "node:url";

import type {
    ApplyWorkspaceEditParams,
    ApplyWorkspaceEditResult,
    CreateFile,
    TextDocumentEdit,
} from "vscode-languageclient/node";

/**
 * Стоковый `typescript-language-server` в `_typescript.applyRefactoring` сам
 * создаёт новый файл (`fs.ensureFile`) и шлёт голые `changes` без
 * `isRefactoring`: после Ctrl+Z пустой файл остаётся на диске. Возвращаем форму
 * эталонного `refactor.ts`: файл, появившийся пустым за время команды,
 * удаляется и приезжает в edit созданием, edit применяется как рефакторинг
 * (`files.refactoring.autoSave`).
 */

export const APPLY_REFACTORING_COMMAND = "_typescript.applyRefactoring";

/** Время создания ядро берёт из «грубых» часов — отстаёт от `Date.now()` на тик планировщика. */
const CLOCK_SLACK_MS = 1_000;

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
    writeEmpty(filePath: string): Promise<void>;
    /** `uri.toString()`; открытый файл существовал до команды. */
    isOpen(uri: string): boolean;
    applyRefactoringEdit(params: ApplyWorkspaceEditParams): Promise<boolean>;
}

type ExecuteCommandNext = (command: string, args: unknown[]) => unknown;
type ApplyEditNext<R> = (params: ApplyWorkspaceEditParams) => R | PromiseLike<R>;

export function createRefactoringEditsMiddleware(host: RefactoringEditsHost): {
    executeCommand(command: string, args: unknown[], next: ExecuteCommandNext): Promise<unknown>;
    handleApplyEdit<R>(params: ApplyWorkspaceEditParams, next: ApplyEditNext<R>): Promise<R | ApplyWorkspaceEditResult>;
} {
    /** Окно — от самого раннего старта. */
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
            // `documentChanges` уже несут создания, если они нужны.
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

async function isFreshEmptyFile(host: RefactoringEditsHost, uri: string, since: number): Promise<boolean> {
    if (!uri.startsWith("file:") || host.isOpen(uri)) return false;
    const stat = await host.stat(fileURLToPath(uri));
    if (stat?.size !== 0) return false;
    const createdAt = stat.birthtimeMs === 0 ? stat.ctimeMs : stat.birthtimeMs;
    return createdAt >= since;
}

/** Создание файла идёт перед его правками. */
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
