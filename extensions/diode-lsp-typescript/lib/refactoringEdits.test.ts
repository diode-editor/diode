import { describe, expect, it, vi } from "vitest";
import type { ApplyWorkspaceEditParams } from "vscode-languageclient/node";

import {
    APPLY_REFACTORING_COMMAND,
    createRefactoringEditsMiddleware,
    type FileStat,
    type RefactoringEditsHost,
    withCreatedFiles,
} from "./refactoringEdits.ts";

const NEW = "file:///proj/src/Foo.ts";
const SOURCE = "file:///proj/src/a.ts";
const INSERT = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: "class Foo {}\n",
};
const REMOVE = { range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } }, newText: "" };

/** A "Move to a new file" edit in the typescript-language-server shape: bare `changes`. */
const MOVE: ApplyWorkspaceEditParams = { edit: { changes: { [NEW]: [INSERT], [SOURCE]: [REMOVE] } } };

function makeHost(files: Record<string, FileStat>, overrides: Partial<RefactoringEditsHost> = {}) {
    const host = {
        now: vi.fn(() => 10_000),
        stat: vi.fn((filePath: string) => Promise.resolve(files[filePath] ?? null)),
        unlink: vi.fn(() => Promise.resolve()),
        writeEmpty: vi.fn(() => Promise.resolve()),
        isOpen: vi.fn((uri: string) => uri === SOURCE),
        applyRefactoringEdit: vi.fn((_params: ApplyWorkspaceEditParams) => Promise.resolve(true)),
        ...overrides,
    };
    return { host, middleware: createRefactoringEditsMiddleware(host) };
}

/** An empty file the server created (`fs.ensureFile`) after the command started. */
const FRESH: FileStat = { size: 0, birthtimeMs: 10_100, ctimeMs: 10_100 };

async function duringRefactoring(
    middleware: ReturnType<typeof makeHost>["middleware"],
    params: ApplyWorkspaceEditParams,
    next = vi.fn(() => ({ applied: true })),
): Promise<unknown> {
    let result: unknown;
    await middleware.executeCommand(APPLY_REFACTORING_COMMAND, [], async () => {
        result = await middleware.handleApplyEdit(params, next);
    });
    return result;
}

describe("diode-lsp-typescript — refactoring edit in the upstream shape", () => {
    it("a new file created by the server comes as a creation: Ctrl+Z removes it", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH });

        expect(await duringRefactoring(middleware, MOVE)).toEqual({ applied: true });

        expect(host.unlink).toHaveBeenCalledExactlyOnceWith("/proj/src/Foo.ts");
        expect(host.applyRefactoringEdit).toHaveBeenCalledExactlyOnceWith({
            edit: {
                documentChanges: [
                    { kind: "create", uri: NEW },
                    { textDocument: { uri: NEW, version: null }, edits: [INSERT] },
                    { textDocument: { uri: SOURCE, version: null }, edits: [REMOVE] },
                ],
            },
        });
        expect(host.writeEmpty).not.toHaveBeenCalled();
    });

    it("a refactoring edit without new files is still a refactoring (files.refactoring.autoSave)", async () => {
        const { host, middleware } = makeHost({});
        const next = vi.fn(() => ({ applied: true }));

        expect(await duringRefactoring(middleware, MOVE, next)).toEqual({ applied: true });

        expect(host.applyRefactoringEdit).toHaveBeenCalledExactlyOnceWith(MOVE);
        expect(next).not.toHaveBeenCalled();
        expect(host.unlink).not.toHaveBeenCalled();
    });

    it("not applied — the server's empty file is restored", async () => {
        const { host, middleware } = makeHost(
            { "/proj/src/Foo.ts": FRESH },
            { applyRefactoringEdit: vi.fn(() => Promise.resolve(false)) },
        );

        expect(await duringRefactoring(middleware, MOVE)).toEqual({ applied: false });
        expect(host.writeEmpty).toHaveBeenCalledExactlyOnceWith("/proj/src/Foo.ts");
    });

    it("outside a refactoring command the edit takes the regular client path", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH });
        const next = vi.fn(() => ({ applied: true }));

        expect(await middleware.handleApplyEdit(MOVE, next)).toEqual({ applied: true });

        expect(next).toHaveBeenCalledExactlyOnceWith(MOVE);
        expect(host.applyRefactoringEdit).not.toHaveBeenCalled();
    });

    it("the window closes together with the command, even a failed one", async () => {
        const { host, middleware } = makeHost({});
        await expect(
            middleware.executeCommand(APPLY_REFACTORING_COMMAND, [], () => Promise.reject(new Error("boom"))),
        ).rejects.toThrow("boom");

        const next = vi.fn(() => ({ applied: true }));
        await middleware.handleApplyEdit(MOVE, next);
        expect(next).toHaveBeenCalledOnce();
        expect(host.applyRefactoringEdit).not.toHaveBeenCalled();
    });

    it("an edit inside a foreign command takes the regular client path", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH });
        const next = vi.fn(() => ({ applied: true }));
        await middleware.executeCommand("_typescript.organizeImports", [], async () => {
            await middleware.handleApplyEdit(MOVE, next);
        });
        expect(next).toHaveBeenCalledExactlyOnceWith(MOVE);
        expect(host.applyRefactoringEdit).not.toHaveBeenCalled();
    });

    it("the window starts at the EARLIEST of the running commands", async () => {
        const times = [10_000, 20_000];
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH }, { now: () => times.shift() ?? 0 });
        await middleware.executeCommand(APPLY_REFACTORING_COMMAND, [], async () => {
            // The second command started after the server created the first one's file.
            await middleware.executeCommand(APPLY_REFACTORING_COMMAND, [], async () => {
                await middleware.handleApplyEdit(MOVE, vi.fn());
            });
        });
        expect(host.unlink).toHaveBeenCalledOnce();
    });

    it("creation time comes from birthtime if the file system stores it", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": { size: 0, birthtimeMs: 10_100, ctimeMs: 1 } });
        await duringRefactoring(middleware, MOVE);
        expect(host.unlink).toHaveBeenCalledOnce();
    });

    it("a foreign command opens no window and passes through as is", async () => {
        const { middleware } = makeHost({});
        const next = vi.fn(() => "result");

        expect(await middleware.executeCommand("_typescript.organizeImports", ["a"], next)).toBe("result");
        expect(next).toHaveBeenCalledExactlyOnceWith("_typescript.organizeImports", ["a"]);
    });

    it("the window holds while any of the parallel commands is running", async () => {
        const { host, middleware } = makeHost({});
        let finishFirst = (): void => {};
        const first = middleware.executeCommand(
            APPLY_REFACTORING_COMMAND,
            [],
            () => new Promise<void>((resolve) => (finishFirst = resolve)),
        );
        await middleware.executeCommand(APPLY_REFACTORING_COMMAND, [], () => Promise.resolve());

        await middleware.handleApplyEdit(MOVE, vi.fn());
        expect(host.applyRefactoringEdit).toHaveBeenCalledOnce();
        finishFirst();
        await first;
    });

    it("only an empty, fresh, closed file: file counts as a creation", async () => {
        const cases: [string, Record<string, FileStat>, Partial<RefactoringEditsHost>][] = [
            ["non-empty", { "/proj/src/Foo.ts": { ...FRESH, size: 3 } }, {}],
            // Created before the command (a one-second margin for a coarse clock).
            ["old", { "/proj/src/Foo.ts": { size: 0, birthtimeMs: 8_999, ctimeMs: 8_999 } }, {}],
            ["open", { "/proj/src/Foo.ts": FRESH }, { isOpen: () => true }],
            ["no file", {}, {}],
        ];
        for (const [name, files, overrides] of cases) {
            const { host, middleware } = makeHost(files, overrides);
            await duringRefactoring(middleware, MOVE);
            expect(host.unlink, name).not.toHaveBeenCalled();
            expect(host.applyRefactoringEdit, name).toHaveBeenCalledWith(MOVE);
        }
    });

    it("a file system without creation time — judge by ctime; a one-second margin for a coarse clock", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": { size: 0, birthtimeMs: 0, ctimeMs: 9_000 } });
        await duringRefactoring(middleware, MOVE);
        expect(host.unlink).toHaveBeenCalledOnce();
    });

    it("a non-file resource is not checked on disk", async () => {
        const { host, middleware } = makeHost({});
        await duringRefactoring(middleware, { edit: { changes: { "untitled:Untitled-1": [INSERT] } } });
        expect(host.stat).not.toHaveBeenCalled();
    });

    it("documentChanges from the server are not rewritten (even next to changes)", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH });
        const params: ApplyWorkspaceEditParams = {
            edit: {
                documentChanges: [{ textDocument: { uri: NEW, version: null }, edits: [INSERT] }],
                changes: { [NEW]: [INSERT] },
            },
        };
        await duringRefactoring(middleware, params);
        expect(host.stat).not.toHaveBeenCalled();
        expect(host.applyRefactoringEdit).toHaveBeenCalledExactlyOnceWith(params);
    });

    it("withCreatedFiles keeps the edit label and annotations", () => {
        const annotations = { a: { label: "Move" } };
        expect(
            withCreatedFiles(
                { label: "Move", edit: { changes: { [NEW]: [INSERT] }, changeAnnotations: annotations } },
                [NEW],
            ),
        ).toEqual({
            label: "Move",
            edit: {
                documentChanges: [
                    { kind: "create", uri: NEW },
                    { textDocument: { uri: NEW, version: null }, edits: [INSERT] },
                ],
                changeAnnotations: annotations,
            },
        });
        expect(withCreatedFiles({ edit: {} }, [])).toEqual({ edit: { documentChanges: [] } });
    });
});
