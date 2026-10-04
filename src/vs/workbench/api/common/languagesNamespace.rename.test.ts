import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace, type ICodeActionDeps } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Position, Range, TextEdit, Uri, WorkspaceEdit } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Субпроцессная сторона rename: ядро зовёт провайдера по handle, правки
// провайдера ложатся через deps.applyEdit (существующий путь
// workspace.applyEdit — bulk edit, одним шагом отмены).

function makeCtx(deps?: Partial<ICodeActionDeps>): {
    stub: IStubRpc;
    languages: typeof vscode.languages;
    appliedEdits: vscode.WorkspaceEdit[];
    documentSync: DocumentSyncTracker;
} {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
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
    // Документ открыт document sync'ом (как `editor.didOpen`): запросы текста
    // не везут, провайдер читает зеркало версии 1.
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: TEXT });
    return { stub, languages, appliedEdits, documentSync: ctx.documentSync };
}

const URI = "file:///proj/main.ts";
const TEXT = "const value = 1;\nconst other = value;\n";

function prepareParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "typescript", version: 1, line: 0, character: 8, ...overrides };
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
                // Placeholder НЕ совпадает с текстом диапазона (там `value`):
                // иначе подстановку из текста не отличить от имени провайдера.
                prepareRename: () => ({
                    range: new Range(0, 6, 0, 11) as unknown as vscode.Range,
                    placeholder: "symbol",
                }),
            },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({ placeholder: "symbol" });
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

    it("документ — из зеркала, позиция — из параметров запроса", async () => {
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

    it("позиция без line/character в параметрах — начало документа", async () => {
        const { stub, languages } = makeCtx();
        const seen: { pos?: vscode.Position } = {};
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                prepareRename: (_document, position) => {
                    seen.pos = position;
                    return null;
                },
            },
        );

        await stub.callRequest("languages.prepareRename", prepareParams({ line: undefined, character: undefined }));

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
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

    it("пустая причина отказа — родовое сообщение, а не пустая строка", async () => {
        const { stub, languages } = makeCtx();
        languages.registerRenameProvider(
            { language: "typescript" },
            {
                provideRenameEdits: () => null,
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- расширение вправе отклонить промис чем угодно, в т.ч. пустой строкой
                prepareRename: () => Promise.reject(""),
            },
        );
        languages.registerRenameProvider(
            { language: "typescript" },
            { provideRenameEdits: () => null, prepareRename: () => Promise.reject(new Error("")) },
        );

        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({
            rejectReason: "Rename failed",
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

    it("запрос без handle провайдера не будит; документ — зеркало, а не запрос", async () => {
        const { stub, languages } = makeCtx();
        const seen: string[] = [];
        const register = (): void => {
            languages.registerRenameProvider(
                { language: "typescript" },
                {
                    provideRenameEdits: () => null,
                    prepareRename: (document) => {
                        seen.push(document.getText());
                        return new Range(0, 0, 0, 1) as unknown as vscode.Range;
                    },
                },
            );
        };
        // Два провайдера: «нет handle» не должно попасть ни в нулевой, ни в
        // соседний — иначе промах читался бы как попадание по умолчанию.
        register();
        register();

        // Без `handle` в параметрах провайдера не ищем вовсе.
        expect(await stub.callRequest("languages.prepareRename", prepareParams({ handle: undefined }))).toBeNull();
        expect(seen).toEqual([]);
        // Текст провайдер видит из зеркала документа (версия 1) — запрос его
        // не везёт.
        expect(await stub.callRequest("languages.prepareRename", prepareParams())).toEqual({ placeholder: "c" });
        expect(seen).toEqual([TEXT]);
    });

    it("не открытый документ, устаревшая и забежавшая вперёд версия — null, провайдер не зовётся", async () => {
        const { stub, languages, documentSync } = makeCtx();
        const prepareRename = vi.fn(() => new Range(0, 6, 0, 11) as unknown as vscode.Range);
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits: () => null, prepareRename });
        documentSync.change({ uri: URI, version: 2, changes: [] });

        const stale = [{ uri: "file:///proj/unknown.ts" }, { version: 1 }, { version: 3 }, { version: undefined }];
        for (const overrides of stale) {
            expect(await stub.callRequest("languages.prepareRename", prepareParams(overrides))).toBeNull();
        }
        expect(prepareRename).not.toHaveBeenCalled();
        // Версия зеркала — провайдер зовётся.
        expect(await stub.callRequest("languages.prepareRename", prepareParams({ version: 2 }))).toEqual({
            placeholder: "value",
        });
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

    it("документ ушёл дальше запроса или не открыт — отказ с причиной, провайдер не зовётся", async () => {
        const { stub, languages, appliedEdits, documentSync } = makeCtx();
        const provideRenameEdits = vi.fn(() => renameEdit("renamed") as unknown as vscode.WorkspaceEdit);
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits });
        documentSync.change({ uri: URI, version: 2, changes: [] });

        for (const overrides of [{ uri: "file:///proj/unknown.ts" }, { version: 1 }, { version: 3 }]) {
            expect(await stub.callRequest("languages.provideRenameEdits", renameParams(overrides))).toEqual({
                applied: false,
                error: "The document changed during rename",
            });
        }
        documentSync.close(Uri.parse(URI));
        expect(await stub.callRequest("languages.provideRenameEdits", renameParams({ version: 2 }))).toEqual({
            applied: false,
            error: "The document changed during rename",
        });
        expect(provideRenameEdits).not.toHaveBeenCalled();
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

    it("запрос без handle провайдера не будит", async () => {
        const { stub, languages } = makeCtx();
        const provideRenameEdits = vi.fn(() => renameEdit("renamed") as unknown as vscode.WorkspaceEdit);
        // Два провайдера — см. prepareRename: промах не должен попадать в соседа.
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits });
        languages.registerRenameProvider({ language: "typescript" }, { provideRenameEdits });

        expect(await stub.callRequest("languages.provideRenameEdits", renameParams({ handle: undefined }))).toEqual({
            applied: false,
        });
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
