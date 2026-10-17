import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createRange } from "../../../editor/common/core/iRange.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Position, Range, SelectionRange } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Субпроцессная сторона Expand/Shrink Selection: ядро зовёт провайдера по
// handle с позициями кареток, цепочка `parent` уезжает развёрнутой.

const URI = "file:///proj/main.ts";
const TEXT = "call(alpha, beta);\n";

function makeCtx(): { stub: IStubRpc; languages: typeof vscode.languages } {
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
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: () => Promise.resolve(true),
        executeCommand: () => Promise.resolve(undefined),
    });
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: TEXT });
    return { stub, languages };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        version: 1,
        positions: [{ line: 0, character: 7 }],
        ...overrides,
    };
}

const asVscode = (range: Range): vscode.Range => range as unknown as vscode.Range;

/** «alpha» → «alpha, beta» → весь вызов. */
function chain(): vscode.SelectionRange {
    const call = new SelectionRange(new Range(0, 0, 0, 17));
    const args = new SelectionRange(new Range(0, 5, 0, 16), call);
    return new SelectionRange(new Range(0, 5, 0, 10), args) as unknown as vscode.SelectionRange;
}

describe("LanguagesNamespace — registerSelectionRangeProvider", () => {
    it("регистрация объявляется ядру видом selectionRange, dispose — снимает", () => {
        const { stub, languages } = makeCtx();
        const registration = languages.registerSelectionRangeProvider("typescript", {
            provideSelectionRanges: () => [],
        });
        registration.dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "selectionRange", selector: [{ language: "typescript" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });
});

describe("LanguagesNamespace — languages.provideSelectionRanges", () => {
    it("цепочка parent разворачивается от внутреннего к внешнему; провайдер видит документ и позиции", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn((_doc: vscode.TextDocument, _positions: readonly vscode.Position[]) => [chain()]);
        languages.registerSelectionRangeProvider("typescript", { provideSelectionRanges: provide });

        expect(await stub.callRequest("languages.provideSelectionRanges", params())).toEqual([
            [createRange(0, 5, 0, 10), createRange(0, 5, 0, 16), createRange(0, 0, 0, 17)],
        ]);
        const [doc, positions] = provide.mock.calls[0];
        expect(doc.getText()).toBe(TEXT);
        expect(positions).toEqual([new Position(0, 7)]);
    });

    it("сбой провайдера, снятый handle и чужая версия документа — «иерархий нет»", async () => {
        const { stub, languages } = makeCtx();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        languages.registerSelectionRangeProvider("typescript", {
            provideSelectionRanges: () => {
                throw new Error("boom");
            },
        });
        expect(await stub.callRequest("languages.provideSelectionRanges", params())).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("provideSelectionRanges failed: "));
        expect(await stub.callRequest("languages.provideSelectionRanges", params({ handle: 9 }))).toEqual([]);
        expect(await stub.callRequest("languages.provideSelectionRanges", params({ version: 7 }))).toEqual([]);
        errors.mockRestore();
    });

    it("запрос идёт провайдеру своего handle; на чужую версию документа провайдер не зовётся", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => []);
        const second = vi.fn(() => [chain()]);
        languages.registerSelectionRangeProvider("typescript", { provideSelectionRanges: first });
        languages.registerSelectionRangeProvider("typescript", { provideSelectionRanges: second });

        expect(await stub.callRequest("languages.provideSelectionRanges", params({ handle: 1, version: 7 }))).toEqual(
            [],
        );
        expect(second).not.toHaveBeenCalled();
        expect(await stub.callRequest("languages.provideSelectionRanges", params({ handle: 1 }))).toHaveLength(1);
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
    });

    it("родитель с тем же концом, что у ребёнка, — законная ступень", async () => {
        const { stub, languages } = makeCtx();
        const args = new SelectionRange(new Range(0, 5, 0, 16));
        const beta = new SelectionRange(new Range(0, 12, 0, 16), args) as unknown as vscode.SelectionRange;
        languages.registerSelectionRangeProvider("typescript", { provideSelectionRanges: () => [beta] });
        expect(
            await stub.callRequest(
                "languages.provideSelectionRanges",
                params({ positions: [{ line: 0, character: 14 }] }),
            ),
        ).toEqual([[createRange(0, 12, 0, 16), createRange(0, 5, 0, 16)]]);
    });

    it("без позиций в запросе провайдер получает пустой список", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn(() => []);
        languages.registerSelectionRangeProvider("typescript", { provideSelectionRanges: provide });
        expect(await stub.callRequest("languages.provideSelectionRanges", params({ positions: undefined }))).toEqual(
            [],
        );
        expect(provide).toHaveBeenCalledWith(expect.anything(), [], expect.anything());
    });

    it("ответ не по каждой позиции или ступень, не содержащая предыдущую, — брак целиком", async () => {
        const { stub, languages } = makeCtx();
        let answer: unknown = [];
        languages.registerSelectionRangeProvider("typescript", {
            provideSelectionRanges: () => answer as vscode.SelectionRange[],
        });
        const call = (): Promise<unknown> => stub.callRequest("languages.provideSelectionRanges", params());

        answer = [chain(), chain()];
        expect(await call()).toEqual([]);
        answer = null;
        expect(await call()).toEqual([]);
        // Первая ступень обязана содержать каретку (0,7).
        answer = [{ range: asVscode(new Range(0, 12, 0, 16)) }];
        expect(await call()).toEqual([]);
        // Родитель уже ребёнка (утиный объект — конструктор SelectionRange такое не пустил бы).
        answer = [{ range: asVscode(new Range(0, 5, 0, 16)), parent: { range: asVscode(new Range(0, 5, 0, 10)) } }];
        expect(await call()).toEqual([]);
        answer = [{ range: { start: 1 } }];
        expect(await call()).toEqual([]);
    });

    it("зацикленный parent обрывается на повторе", async () => {
        const { stub, languages } = makeCtx();
        const node: { range: vscode.Range; parent?: unknown } = { range: asVscode(new Range(0, 0, 0, 17)) };
        node.parent = node;
        languages.registerSelectionRangeProvider("typescript", {
            provideSelectionRanges: () => [node as vscode.SelectionRange],
        });
        expect(await stub.callRequest("languages.provideSelectionRanges", params())).toEqual([
            [createRange(0, 0, 0, 17)],
        ]);
    });
});

describe("vscode.SelectionRange", () => {
    it("родитель обязан содержать диапазон — как в эталоне", () => {
        const parent = new SelectionRange(new Range(0, 0, 0, 5));
        expect(new SelectionRange(new Range(0, 1, 0, 2), parent).parent).toBe(parent);
        expect(() => new SelectionRange(new Range(0, 0, 0, 9), parent)).toThrow(
            "Invalid argument: parent must contain this range",
        );
    });
});
