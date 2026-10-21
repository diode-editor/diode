import { fileURLToPath } from "node:url";

import type {
    ApplyWorkspaceEditParams,
    ApplyWorkspaceEditResult,
    CreateFile,
    TextDocumentEdit,
} from "vscode-languageclient/node";

/**
 * The stock `typescript-language-server` creates the new file itself in
 * `_typescript.applyRefactoring` (`fs.ensureFile`) and sends bare `changes` without
 * `isRefactoring`: after Ctrl+Z the empty file stays on disk. We restore the shape of
 * upstream `refactor.ts`: a file that appeared empty during the command is
 * deleted and comes in the edit as a creation, and the edit applies as a refactoring
 * (`files.refactoring.autoSave`).
 */

export const APPLY_REFACTORING_COMMAND = "_typescript.applyRefactoring";

/** The kernel takes creation time from a coarse clock that lags `Date.now()` by a scheduler tick. */
const CLOCK_SLACK_MS = 1_000;

export interface FileStat {
    readonly size: number;
    /** Creation time; `0` when the file system does not store it. */
    readonly birthtimeMs: number;
    readonly ctimeMs: number;
}

export interface RefactoringEditsHost {
    now(): number;
    /** `null` when the file does not exist. */
    stat(filePath: string): Promise<FileStat | null>;
    unlink(filePath: string): Promise<void>;
    writeEmpty(filePath: string): Promise<void>;
    /** `uri.toString()`; an open file existed before the command. */
    isOpen(uri: string): boolean;
    applyRefactoringEdit(params: ApplyWorkspaceEditParams): Promise<boolean>;
}

type ExecuteCommandNext = (command: string, args: unknown[]) => unknown;
type ApplyEditNext<R> = (params: ApplyWorkspaceEditParams) => R | PromiseLike<R>;

export function createRefactoringEditsMiddleware(host: RefactoringEditsHost): {
    executeCommand(command: string, args: unknown[], next: ExecuteCommandNext): Promise<unknown>;
    handleApplyEdit<R>(params: ApplyWorkspaceEditParams, next: ApplyEditNext<R>): Promise<R | ApplyWorkspaceEditResult>;
} {
    /** The window starts at the earliest start. */
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
            // `documentChanges` already carry the creations if they are needed.
            if (params.edit.documentChanges === undefined) {
                for (const uri of Object.keys(params.edit.changes ?? {})) {
                    if (await isFreshEmptyFile(host, uri, since)) created.push(uri);
                }
            }
            for (const uri of created) await host.unlink(fileURLToPath(uri));
            const applied = await host.applyRefactoringEdit(
                created.length === 0 ? params : withCreatedFiles(params, created),
            );
            // Not applied: the server relies on its file, so restore it.
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

/** A file creation goes before its edits. */
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
