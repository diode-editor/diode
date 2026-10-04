import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace, type ICodeActionDeps } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Position, Range, TextEdit, Uri, WorkspaceEdit } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Субпроцессная сторона rename: ядро зовёт провайдера по handle, правки
// провайдера ложатся через deps.applyEdit (существующий путь
// workspace.applyEdit — bulk edit, одним шагом отмены).

function makeCtx(deps?: Partial<ICodeActionDeps>): {
    stub: IStubRpc;
    languages: typeof vscode.languages;
    appliedEdits: vscode.WorkspaceEdit[];
} {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const appliedEdits: vscode.WorkspaceEdit[] = [];
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: (edit) => {
            appliedEdits.push(edit);
            return Promise.resolve(true);
        },
        executeCommand: () => Promise.resolve(undefined),
        ...deps,
    });
    return { stub, languages, appliedEdits };
}

const URI = "file:///proj/main.ts";
const TEXT = "const value = 1;\nconst other = value;\n";

function prepareParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "typescript", text: TEXT, line: 0, character: 8, ...overrides };
}

function renameParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...prepareParams(), newName: "renamed", ...overrides };
}

/** Правка-пустышка: что именно переименовано, решает провайдер — нам важен сам edit. */
function renameEdit(newName: string): WorkspaceEdit {
    const edit = new WorkspaceEdit();
    edit.set(Uri.parse(URI) as unknown as vscode.Uri, [
        new TextEdit(new Range(0, 6, 0, 11), newName) as unknown as vscode.TextEdit,
    ]);
    return edit;
}

describe("LanguagesNamespace — registerRenameProvider", () => {
    it("регистрация объявляется ядру с handle и селектором, dispose — снимает (один раз)", () => {
        const { stub, languages } = makeCtx();
        const sent = (): typeof stub.notifies => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const registration = languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => null },
        );
        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "rename", selector: [{ language: "typescript" }] },
            },
        ]);

        registration.dispose();
        registration.dispose();
        expect(sent().slice(1)).toEqual([{ method: "languages.unregister", params: { handle: 0 } }]);
    });
});

describe("LanguagesNamespace — languages.prepareRename", () => {
    it("`{range, placeholder}` провайдера доезжает именем символа", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: () => ({
                    range: new Range(0, 6, 0, 11) as unknown as vscode.Range,
                    placeholder: "value",
                }),
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({ placeholder: "value" });
    });

    it("голый Range — placeholder добирается текстом документа в этом диапазоне", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: () => new Range(0, 6, 0, 11) as unknown as vscode.Range,
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({ placeholder: "value" });
    });

    it("пустой placeholder провайдера — тоже добирается из текста", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: () => ({ range: new Range(0, 6, 0, 11) as unknown as vscode.Range, placeholder: "" }),
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({ placeholder: "value" });
    });

    it("пустой диапазон без placeholder'а — «сказать нечего» (имя доберёт ядро)", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: () => new Range(0, 6, 0, 6) as unknown as vscode.Range,
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toBeNull();
    });

    it("документ и позиция приезжают провайдеру из параметров запроса", async () => {
        const { stub, languages } = makeCtx();
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: (document, position) => {
                    seen.doc = document;
                    seen.pos = position;
                    return new Range(1, 6, 1, 11) as unknown as vscode.Range;
                },
            },
        );

        await stub.callRequest("languages.prepareRename", prepareParams({ line: 1, character: 7 }));

        expect(seen.doc?.getText()).toBe(TEXT);
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(1);
        expect(seen.pos?.character).toBe(7);
    });

    it("отказ провайдера — причина человеку («здесь переименовать нельзя»)", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: () => Promise.reject(new Error("You cannot rename this element.")),
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({
            rejectReason: "You cannot rename this element.",
        });
    });

    it("отказ строкой и отказ без причины — тоже с текстом", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- расширение вправе отклонить промис чем угодно, в т.ч. строкой
                prepareRename: () => Promise.reject("not an identifier"),
            },
        );
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- расширение вправе отклонить промис чем угодно
                prepareRename: () => Promise.reject(undefined),
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({
            rejectReason: "not an identifier",
        });
        expect(await stub.callRequest("languages.prepareRename", prepareParams({ handle: 1 }))).toEqual({
            rejectReason: "Rename failed",
        });
    });

    it("провайдер без prepareRename — null: слово под кареткой доберёт ядро", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits: () => null });

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toBeNull();
    });

    it("`null`/`undefined` и мусорная форма от провайдера — null", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => null, prepareRename: () => null },
        );
        languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => null, prepareRename: () => ({ placeholder: "value" }) as never },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toBeNull();
        expect(await stub.callRequest("languages.prepareRename", prepareParams({ handle: 1 }))).toBeNull();
    });

    it("снятый провайдер — null, чужой handle провайдера не будит", async () => {
        const { stub, languages } = makeCtx();
        const prepareRename = vi.fn(() => new Range(0, 6, 0, 11) as unknown as vscode.Range);
        const registration = languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => null, prepareRename },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams({ handle: 7 }))).toBeNull();
        registration.dispose();
        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toBeNull();
        expect(prepareRename).not.toHaveBeenCalled();
    });
});

describe("LanguagesNamespace — languages.provideRenameEdits", () => {
    it("WorkspaceEdit провайдера уезжает в applyEdit, ответ — applied", async () => {
        const { stub, languages, appliedEdits } = makeCtx();
        const provideRenameEdits = vi.fn(() => renameEdit("renamed") as unknown as vscode.WorkspaceEdit);
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits });

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams())).toEqual({ applied: true });
        expect(appliedEdits).toHaveLength(1);
        expect(appliedEdits[0].get(Uri.parse(URI) as unknown as vscode.Uri)[0].newText).toBe("renamed");
        // Новое имя и позиция доезжают провайдеру дословно.
        const [document, position, newName] = provideRenameEdits.mock.calls[0] as unknown as [
            vscode.TextDocument,
            Position,
            string,
        ];
        expect(document.getText()).toBe(TEXT);
        expect(position.line).toBe(0);
        expect(position.character).toBe(8);
        expect(newName).toBe("renamed");
    });

    it("отказ applyEdit — applied: false с сообщением", async () => {
        const { stub, languages } = makeCtx({ applyEdit: () => Promise.resolve(false) });
        languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => renameEdit("renamed") as unknown as vscode.WorkspaceEdit },
        );

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams())).toEqual({
            applied: false,
            error: "Rename failed to apply edits",
        });
    });

    it("отклонённый промис провайдера — его сообщение человеку", async () => {
        const { stub, languages, appliedEdits } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => Promise.reject(new Error("Invalid name: 123")) },
        );

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams())).toEqual({
            applied: false,
            error: "Invalid name: 123",
        });
        expect(appliedEdits).toHaveLength(0);
    });

    it("отказ строкой и отказ без причины — тоже с текстом", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- расширение вправе отклонить промис чем угодно, в т.ч. строкой
                provideRenameEdits: () => Promise.reject("newName is a keyword"),
            },
        );
        languages.registerRenameProvider(
            { language: "typescript" },
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- расширение вправе отклонить промис чем угодно
            { provideRenameEdits: () => Promise.reject(undefined) },
        );

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams())).toEqual({
            applied: false,
            error: "newName is a keyword",
        });
        expect(await stub.callRequest("languages.provideRenameEdits", renameParams({ handle: 1 }))).toEqual({
            applied: false,
            error: "Rename failed",
        });
    });

    it("не-WorkspaceEdit от провайдера правками не считается: applied: false БЕЗ сообщения", async () => {
        const { stub, languages, appliedEdits } = makeCtx();
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits: () => null });
        languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => ({ size: 1 }) as unknown as vscode.WorkspaceEdit },
        );

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams())).toEqual({ applied: false });
        expect(await stub.callRequest("languages.provideRenameEdits", renameParams({ handle: 1 }))).toEqual({
            applied: false,
        });
        expect(appliedEdits).toHaveLength(0);
    });

    it("без нового имени провайдера не зовём вовсе", async () => {
        const { stub, languages } = makeCtx();
        const provideRenameEdits = vi.fn(() => renameEdit("renamed") as unknown as vscode.WorkspaceEdit);
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits });

        for (const newName of ["", undefined, 42]) {
            expect(await stub.callRequest("languages.provideRenameEdits", renameParams({ newName }))).toEqual({
                applied: false,
                error: "Rename requires a new name",
            });
        }
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("снятый провайдер — applied: false, чужой handle провайдера не будит", async () => {
        const { stub, languages } = makeCtx();
        const provideRenameEdits = vi.fn(() => renameEdit("renamed") as unknown as vscode.WorkspaceEdit);
        const registration = languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits });

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams({ handle: 7 }))).toEqual({
            applied: false,
        });
        registration.dispose();
        expect(await stub.callRequest("languages.provideRenameEdits", renameParams())).toEqual({ applied: false });
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });
});
