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

/** Правка «Move to a new file» в форме typescript-language-server: голые `changes`. */
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

/** Пустой файл, который сервер создал (`fs.ensureFile`) после старта команды. */
const FRESH: FileStat = { size: 0, birthtimeMs: 10_100, ctimeMs: 10_100 };

/** Применяет `params` внутри команды рефакторинга — как это делает сервер. */
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

describe("diode-lsp-typescript — правка рефакторинга в форме эталона", () => {
    it("новый файл, созданный сервером, приезжает созданием: Ctrl+Z его уберёт", async () => {
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

    it("правка рефакторинга без новых файлов — всё равно рефакторинг (files.refactoring.autoSave)", async () => {
        const { host, middleware } = makeHost({});
        const next = vi.fn(() => ({ applied: true }));

        expect(await duringRefactoring(middleware, MOVE, next)).toEqual({ applied: true });

        expect(host.applyRefactoringEdit).toHaveBeenCalledExactlyOnceWith(MOVE);
        expect(next).not.toHaveBeenCalled();
        expect(host.unlink).not.toHaveBeenCalled();
    });

    it("не применилось — пустой файл сервера возвращается на место", async () => {
        const { host, middleware } = makeHost(
            { "/proj/src/Foo.ts": FRESH },
            { applyRefactoringEdit: vi.fn(() => Promise.resolve(false)) },
        );

        expect(await duringRefactoring(middleware, MOVE)).toEqual({ applied: false });
        expect(host.writeEmpty).toHaveBeenCalledExactlyOnceWith("/proj/src/Foo.ts");
    });

    it("вне команды рефакторинга правка идёт штатным путём клиента", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH });
        const next = vi.fn(() => ({ applied: true }));

        expect(await middleware.handleApplyEdit(MOVE, next)).toEqual({ applied: true });

        expect(next).toHaveBeenCalledExactlyOnceWith(MOVE);
        expect(host.applyRefactoringEdit).not.toHaveBeenCalled();
    });

    it("окно закрывается вместе с командой, даже упавшей", async () => {
        const { host, middleware } = makeHost({});
        await expect(
            middleware.executeCommand(APPLY_REFACTORING_COMMAND, [], () => Promise.reject(new Error("boom"))),
        ).rejects.toThrow("boom");

        const next = vi.fn(() => ({ applied: true }));
        await middleware.handleApplyEdit(MOVE, next);
        expect(next).toHaveBeenCalledOnce();
        expect(host.applyRefactoringEdit).not.toHaveBeenCalled();
    });

    it("чужая команда окна не открывает и уходит дальше как есть", async () => {
        const { middleware } = makeHost({});
        const next = vi.fn(() => "result");

        expect(await middleware.executeCommand("_typescript.organizeImports", ["a"], next)).toBe("result");
        expect(next).toHaveBeenCalledExactlyOnceWith("_typescript.organizeImports", ["a"]);
    });

    it("окно держится, пока идёт хоть одна из параллельных команд", async () => {
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

    it("созданием считается только пустой, свежий, закрытый file:-файл", async () => {
        const cases: [string, Record<string, FileStat>, Partial<RefactoringEditsHost>][] = [
            // Непустой — существовал с содержимым.
            ["непустой", { "/proj/src/Foo.ts": { ...FRESH, size: 3 } }, {}],
            // Создан раньше команды (запас на грубые часы — секунда).
            ["старый", { "/proj/src/Foo.ts": { size: 0, birthtimeMs: 8_999, ctimeMs: 8_999 } }, {}],
            // Открыт в редакторе — значит, был до команды.
            ["открытый", { "/proj/src/Foo.ts": FRESH }, { isOpen: () => true }],
            // Файла нет вовсе.
            ["нет файла", {}, {}],
        ];
        for (const [name, files, overrides] of cases) {
            const { host, middleware } = makeHost(files, overrides);
            await duringRefactoring(middleware, MOVE);
            expect(host.unlink, name).not.toHaveBeenCalled();
            expect(host.applyRefactoringEdit, name).toHaveBeenCalledWith(MOVE);
        }
    });

    it("файловая система без времени создания — судим по ctime; запас в секунду на грубые часы", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": { size: 0, birthtimeMs: 0, ctimeMs: 9_000 } });
        await duringRefactoring(middleware, MOVE);
        expect(host.unlink).toHaveBeenCalledOnce();
    });

    it("не-file ресурс не проверяется на диске", async () => {
        const { host, middleware } = makeHost({});
        await duringRefactoring(middleware, { edit: { changes: { "untitled:Untitled-1": [INSERT] } } });
        expect(host.stat).not.toHaveBeenCalled();
    });

    it("documentChanges от сервера не переписываются", async () => {
        const { host, middleware } = makeHost({ "/proj/src/Foo.ts": FRESH });
        const params: ApplyWorkspaceEditParams = {
            edit: { documentChanges: [{ textDocument: { uri: NEW, version: null }, edits: [INSERT] }] },
        };
        await duringRefactoring(middleware, params);
        expect(host.stat).not.toHaveBeenCalled();
        expect(host.applyRefactoringEdit).toHaveBeenCalledExactlyOnceWith(params);
    });

    it("withCreatedFiles сохраняет метку и аннотации правки", () => {
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
