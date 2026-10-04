import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { CodeAction, CodeActionKind, CompletionItem, Range, TextEdit } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Ответ языкового провайдера хост не перепроверяет: форму провода гарантирует
// сериализатор субпроцесса. Здесь — проверки, которые раньше делал только
// хостовый разбор `parseWire*`: конечность чисел, кламп индексов подсказки,
// пустые строки, испорченные поля объектов расширения.

const URI = "file:///proj/main.ts";
const TARGET = "file:///proj/target.ts";
/** Диапазон на проводе — core `IRange`. */
const RANGE = { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } };

function setup(): { languages: typeof vscode.languages; stub: IStubRpc } {
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
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: "greet(name)\n" });
    return { languages: createLanguagesNamespace(ctx).languages, stub };
}

const DOC = { uri: URI, languageId: "typescript", version: 1 };
const POSITION = { ...DOC, line: 0, character: 6 };

/** Диапазон расширения с испорченной координатой (`Position` клампит к нулю, но `NaN` пропускает). */
function rangeWith(line: number): Range {
    return new Range(line, 1, 0, 2);
}

describe("languagesNamespace — диапазоны: координаты только конечные числа", () => {
    it("definition и references: цель с NaN/Infinity в диапазоне или пустым uri отбрасывается", async () => {
        const { languages, stub } = setup();
        const items = [
            { uri: TARGET, range: rangeWith(NaN) },
            { uri: TARGET, range: { start: { line: Infinity, character: 0 }, end: { line: 0, character: 0 } } },
            { targetUri: TARGET, targetRange: rangeWith(Infinity) },
            { uri: "", range: new Range(0, 1, 0, 2) },
            { targetUri: "", targetRange: new Range(0, 1, 0, 2) },
            { uri: TARGET, range: new Range(0, 1, 0, 2) },
        ];
        languages.registerDefinitionProvider("typescript", {
            provideDefinition: () => items as unknown as vscode.Location[],
        });
        languages.registerReferenceProvider("typescript", {
            provideReferences: () => items as unknown as vscode.Location[],
        });
        const expected = [{ uri: TARGET, range: RANGE }];
        expect(await stub.callRequest("languages.provideDefinition", { ...POSITION, handle: 0 })).toEqual(expected);
        expect(
            await stub.callRequest("languages.provideReferences", { ...POSITION, handle: 1, includeDeclaration: true }),
        ).toEqual(expected);
    });

    it("hover: кривой диапазон теряется, hover остаётся", async () => {
        const { languages, stub } = setup();
        languages.registerHoverProvider("typescript", {
            provideHover: () => ({ contents: ["doc"], range: rangeWith(NaN) }) as unknown as vscode.Hover,
        });
        expect(await stub.callRequest("languages.provideHover", { ...POSITION, handle: 0 })).toEqual({
            contents: ["doc"],
        });
    });

    it("completion: диапазон с NaN теряется, пункт остаётся; kind — только конечное число", async () => {
        const { languages, stub } = setup();
        const broken = new CompletionItem("broken");
        broken.range = rangeWith(NaN);
        broken.kind = NaN as vscode.CompletionItemKind;
        const infinite = new CompletionItem("infinite");
        infinite.kind = Infinity as vscode.CompletionItemKind;
        const ok = new CompletionItem("ok");
        ok.range = new Range(0, 1, 0, 2);
        ok.kind = 2 as vscode.CompletionItemKind;
        languages.registerCompletionItemProvider("typescript", {
            provideCompletionItems: () => [broken, infinite, ok] as unknown as vscode.CompletionItem[],
        });
        const [result] = (await stub.callRequest("languages.provideCompletionItems", {
            ...POSITION,
            handles: [0],
        })) as { items: Record<string, unknown>[] }[];
        expect(result.items.map(({ label, kind, range }) => ({ label, kind, range }))).toEqual([
            { label: "broken", kind: undefined, range: undefined },
            { label: "infinite", kind: undefined, range: undefined },
            { label: "ok", kind: 2, range: RANGE },
        ]);
        expect(Object.keys(result.items[0])).not.toContain("kind");
    });

    it("completion: команда null не роняет ответ — пункт едет без команды", async () => {
        const { languages, stub } = setup();
        languages.registerCompletionItemProvider("typescript", {
            provideCompletionItems: () => [{ label: "a", command: null }] as unknown as vscode.CompletionItem[],
        });
        expect(await stub.callRequest("languages.provideCompletionItems", { ...POSITION, handles: [0] })).toEqual([
            { items: [{ label: "a", insertText: "a", id: expect.any(String) as string }], isIncomplete: false },
        ]);
    });

    it("resolve и форматирование: правка с нечисловым диапазоном отбрасывается поштучно", async () => {
        const { languages, stub } = setup();
        const edits = [TextEdit.replace(rangeWith(NaN), "bad"), TextEdit.replace(new Range(0, 1, 0, 2), "ok")];
        languages.registerCompletionItemProvider("typescript", {
            provideCompletionItems: () => [new CompletionItem("a")],
            resolveCompletionItem: (item) => Object.assign(item, { additionalTextEdits: edits }),
        });
        languages.registerDocumentFormattingEditProvider("typescript", {
            provideDocumentFormattingEdits: () => edits,
        });
        const [list] = (await stub.callRequest("languages.provideCompletionItems", {
            ...POSITION,
            handles: [0],
        })) as { items: { id: string }[] }[];
        expect(await stub.callRequest("languages.resolveCompletionItem", { id: list.items[0].id })).toEqual({
            additionalEdits: [{ range: RANGE, text: "ok" }],
        });
        expect(await stub.callRequest("languages.provideFormattingEdits", { ...DOC, handle: 1 })).toEqual([
            { range: RANGE, text: "ok" },
        ]);
    });

    it("inline completions: кривой диапазон теряется, пункт остаётся", async () => {
        const { languages, stub } = setup();
        languages.registerInlineCompletionItemProvider("typescript", {
            provideInlineCompletionItems: () => [{ insertText: "x", range: rangeWith(NaN) }],
        });
        expect(
            await stub.callRequest("languages.provideInlineCompletions", { ...POSITION, handles: [0], triggerKind: 0 }),
        ).toEqual([[{ insertText: "x" }]]);
    });

    it("folding: kind — только конечное число", async () => {
        const { languages, stub } = setup();
        languages.registerFoldingRangeProvider("typescript", {
            provideFoldingRanges: () =>
                [
                    { start: 0, end: 2, kind: Infinity },
                    { start: 0, end: 2, kind: 1 },
                ] as unknown as vscode.FoldingRange[],
        });
        expect(await stub.callRequest("languages.provideFoldingRanges", { ...DOC, handles: [0] })).toEqual([
            [
                { start: 0, end: 2 },
                { start: 0, end: 2, kind: 1 },
            ],
        ]);
    });
});

describe("languagesNamespace — подсказка параметров: индексы и числа приводятся здесь", () => {
    /** Ответ провайдера одной сигнатурой с двумя параметрами. */
    function signatureHelpWith(fields: Record<string, unknown>, signature: Record<string, unknown> = {}): unknown {
        return {
            signatures: [{ label: "greet(a, b)", parameters: [{ label: "a" }, { label: "b" }], ...signature }],
            ...fields,
        };
    }

    async function serialize(raw: unknown): Promise<unknown> {
        const { languages, stub } = setup();
        languages.registerSignatureHelpProvider("typescript", {
            provideSignatureHelp: () => raw as vscode.SignatureHelp,
        });
        return stub.callRequest("languages.provideSignatureHelp", { ...POSITION, handle: 0 });
    }

    it("activeSignature вне списка, отрицательный и дробный приводится к нулю", async () => {
        for (const activeSignature of [1, -1, 0.5, NaN]) {
            expect(await serialize(signatureHelpWith({ activeSignature })), String(activeSignature)).toMatchObject({
                activeSignature: 0,
            });
        }
        const two = {
            signatures: [{ label: "f(a)" }, { label: "f(a, b)" }],
            activeSignature: 1,
        };
        expect(await serialize(two)).toMatchObject({ activeSignature: 1 });
    });

    it("activeParameter: -1 едет как есть, NaN и Infinity — нулём; у сигнатуры — отбрасывается", async () => {
        expect(await serialize(signatureHelpWith({ activeParameter: -1 }))).toMatchObject({ activeParameter: -1 });
        for (const activeParameter of [NaN, Infinity]) {
            const result = (await serialize(signatureHelpWith({ activeParameter }, { activeParameter }))) as {
                activeParameter: number;
                signatures: Record<string, unknown>[];
            };
            expect(result.activeParameter, String(activeParameter)).toBe(0);
            expect(Object.keys(result.signatures[0])).not.toContain("activeParameter");
        }
    });

    it("метка параметра парой не конечных офсетов роняет весь ответ", async () => {
        expect(await serialize({ signatures: [{ label: "f(a)", parameters: [{ label: [NaN, 1] }] }] })).toBeNull();
        expect(await serialize({ signatures: [{ label: "f(a)", parameters: [{ label: [0, Infinity] }] }] })).toBeNull();
    });

    it("пустая документация сигнатуры и параметра не доезжает до попапа", async () => {
        const result = await serialize({
            signatures: [
                { label: "f(a)", documentation: "", parameters: [{ label: "a", documentation: { value: "" } }] },
            ],
        });
        expect(result).toEqual({
            signatures: [{ label: "f(a)", parameters: [{ label: "a" }] }],
            activeSignature: 0,
            activeParameter: 0,
        });
    });
});

describe("languagesNamespace — code actions: вид — только строка", () => {
    it("kind с нестроковым value теряется, действие остаётся", async () => {
        const { languages, stub } = setup();
        const broken = new CodeAction("broken", new CodeActionKind(42 as unknown as string));
        const ok = new CodeAction("ok", CodeActionKind.QuickFix);
        languages.registerCodeActionsProvider("typescript", { provideCodeActions: () => [broken, ok] });
        const result = (await stub.callRequest("languages.provideCodeActions", {
            ...DOC,
            handle: 0,
            range: RANGE,
        })) as Record<string, unknown>[];
        expect(result.map(({ title, kind }) => ({ title, kind }))).toEqual([
            { title: "broken", kind: undefined },
            { title: "ok", kind: "quickfix" },
        ]);
        expect(Object.keys(result[0])).not.toContain("kind");
    });
});
