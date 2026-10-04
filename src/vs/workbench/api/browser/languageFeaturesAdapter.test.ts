import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { CancellationTokenNone } from "../../../base/common/cancellation.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";
import { LanguageFeaturesService } from "../../../editor/common/services/languageFeaturesService.ts";
import type { IExtensionLanguageFeaturesBridge } from "../common/iExtensionLanguageFeatures.ts";
import type { IWireLanguageProviderRegistration } from "../common/wireTypes.ts";

import { LanguageFeaturesAdapter } from "./languageFeaturesAdapter.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const MD = { uri: Uri.file("/w/b.md"), languageId: "markdown" };
const REQUEST: IHoverRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 0,
};

/** Мост-заглушка: регистрации задаёт тест, событие — `fire()`. */
function makeBridge(): IExtensionLanguageFeaturesBridge & {
    providers: IWireLanguageProviderRegistration[];
    fire(): void;
    listeners: number;
} {
    const listeners: (() => void)[] = [];
    const bridge = {
        providers: [] as IWireLanguageProviderRegistration[],
        getLanguageProviders: () => bridge.providers,
        onLanguageProvidersChanged: (cb: () => void) => {
            listeners.push(cb);
            return {
                dispose: () => {
                    listeners.splice(listeners.indexOf(cb), 1);
                },
            };
        },
        provideHover: vi.fn((handle: number) => Promise.resolve({ contents: [`handle ${String(handle)}`] })),
        provideDefinition: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///def${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        provideSignatureHelp: vi.fn((handle: number) =>
            Promise.resolve({
                signatures: [{ label: `sig ${String(handle)}`, parameters: [] }],
                activeSignature: 0,
                activeParameter: 0,
            }),
        ),
        provideCompletionItems: vi.fn((handle: number) =>
            Promise.resolve({ items: [{ label: `c${String(handle)}`, insertText: "c" }], isIncomplete: false }),
        ),
        resolveCompletionItem: vi.fn((id: string) => Promise.resolve({ detail: `resolved ${id}` })),
        provideFormattingEdits: vi.fn((handle: number) =>
            Promise.resolve([{ range: createRange(0, 0, 0, 0), text: `f${String(handle)}` }]),
        ),
        provideCodeActions: vi.fn((handle: number) => Promise.resolve([{ id: `${String(handle)}.0`, title: "fix" }])),
        applyCodeAction: vi.fn(() => Promise.resolve(true)),
        provideInlineCompletions: vi.fn((handle: number, _request: unknown, _token: unknown) =>
            Promise.resolve([{ insertText: `ghost ${String(handle)}` }]),
        ),
        provideFoldingRanges: vi.fn((handle: number) =>
            Promise.resolve([{ startLine: handle, endLine: handle + 2, isCollapsed: false }]),
        ),
        prepareRename: vi.fn((handle: number) =>
            Promise.resolve({ kind: "name" as const, name: `symbol${String(handle)}` }),
        ),
        provideRenameEdits: vi.fn((handle: number, _request: unknown, newName: string) =>
            Promise.resolve({ applied: newName === `ok${String(handle)}` }),
        ),
        provideReferences: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///ref${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        fire: () => {
            for (const cb of [...listeners]) cb();
        },
        get listeners() {
            return listeners.length;
        },
    };
    return bridge;
}

const hover = (handle: number, language = "typescript"): IWireLanguageProviderRegistration => ({
    handle,
    kind: "hover",
    selector: [{ language }],
});

describe("LanguageFeaturesAdapter", () => {
    it("подхватывает регистрации, объявленные до создания адаптера", async () => {
        const bridge = makeBridge();
        bridge.providers = [hover(1)];
        const features = new LanguageFeaturesService();

        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.hoverProvider.ordered(TS);
        const token = new CancellationTokenSource().token;
        expect(await provider.provideHover(REQUEST, token)).toEqual({ contents: ["handle 1"] });
        // Токен запроса доезжает до хоста — с ним и уходит отмена провайдеру расширения.
        expect(bridge.provideHover).toHaveBeenCalledWith(1, REQUEST, token);
    });

    it("definition и references — прокси в своих реестрах, зовут хост со своим handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 4, kind: "definition", selector: [{ language: "typescript" }] },
            { handle: 5, kind: "references", selector: [{ language: "typescript" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        expect(features.hoverProvider.has(TS)).toBe(false);

        const [definition] = features.definitionProvider.ordered(TS);
        const token = new CancellationTokenSource().token;
        expect(await definition.provideDefinition(REQUEST, token)).toEqual([
            { uri: "file:///def4.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(bridge.provideDefinition).toHaveBeenCalledWith(4, REQUEST, token);

        const referenceRequest = { ...REQUEST, includeDeclaration: true };
        const [references] = features.referenceProvider.ordered(TS);
        expect(await references.provideReferences(referenceRequest, token)).toEqual([
            { uri: "file:///ref5.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(bridge.provideReferences).toHaveBeenCalledWith(5, referenceRequest, token);
    });

    it("rename — прокси в своём реестре: обе ручки зовут хост со своим handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 9, kind: "rename", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.renameProvider.ordered(TS);
        expect(await provider.prepareRename(REQUEST)).toEqual({ kind: "name", name: "symbol9" });
        expect(bridge.prepareRename).toHaveBeenCalledWith(9, REQUEST);

        expect(await provider.provideRenameEdits(REQUEST, "ok9")).toEqual({ applied: true });
        expect(bridge.provideRenameEdits).toHaveBeenCalledWith(9, REQUEST, "ok9");
        // Новое имя доезжает дословно: чужое имя провайдер не применяет.
        expect(await provider.provideRenameEdits(REQUEST, "other")).toEqual({ applied: false });
    });

    it("signatureHelp: триггеры из метаданных регистрации, без метаданных — пустые", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            {
                handle: 6,
                kind: "signatureHelp",
                selector: [{ language: "typescript" }],
                triggerCharacters: ["("],
                retriggerCharacters: [")"],
            },
            { handle: 7, kind: "signatureHelp", selector: [{ language: "markdown" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [ts] = features.signatureHelpProvider.ordered(TS);
        expect(ts.triggerCharacters).toEqual(["("]);
        expect(ts.retriggerCharacters).toEqual([")"]);
        const request = { ...REQUEST, triggerKind: 1 as const, isRetrigger: false };
        const token = new CancellationTokenSource().token;
        expect((await ts.provideSignatureHelp(request, token))?.signatures[0].label).toBe("sig 6");
        expect(bridge.provideSignatureHelp).toHaveBeenCalledWith(6, request, token);

        const [md] = features.signatureHelpProvider.ordered(MD);
        expect(md.triggerCharacters).toEqual([]);
        expect(md.retriggerCharacters).toEqual([]);
    });

    it("completion: триггеры из метаданных, provide с handle, resolve — по id пункта", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 8, kind: "completion", selector: [{ language: "typescript" }], triggerCharacters: ["."] },
            { handle: 9, kind: "completion", selector: [{ language: "markdown" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [ts] = features.completionProvider.ordered(TS);
        expect(ts.triggerCharacters).toEqual(["."]);
        const token = new CancellationTokenSource().token;
        expect(await ts.provideCompletionItems(REQUEST, token)).toEqual({
            items: [{ label: "c8", insertText: "c" }],
            isIncomplete: false,
        });
        expect(bridge.provideCompletionItems).toHaveBeenCalledWith(8, REQUEST, token);
        expect(await ts.resolveCompletionItem?.("1.0")).toEqual({ detail: "resolved 1.0" });

        const [md] = features.completionProvider.ordered(MD);
        expect(md.triggerCharacters).toEqual([]);
    });

    it("formatting/rangeFormatting/codeActions — прокси в своих реестрах, виды — из метаданных", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 1, kind: "formatting", selector: [{ language: "typescript" }] },
            { handle: 2, kind: "rangeFormatting", selector: [{ language: "typescript" }] },
            {
                handle: 3,
                kind: "codeActions",
                selector: [{ language: "typescript" }],
                providedCodeActionKinds: ["source.organizeImports"],
            },
            { handle: 4, kind: "codeActions", selector: [{ language: "markdown" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const format = { ...REQUEST, tabSize: 4, insertSpaces: true };

        const [documentFormatter] = features.documentFormattingEditProvider.ordered(TS);
        expect(await documentFormatter.provideDocumentFormattingEdits(format)).toEqual([
            { range: createRange(0, 0, 0, 0), text: "f1" },
        ]);
        const [rangeFormatter] = features.documentRangeFormattingEditProvider.ordered(TS);
        const ranged = { ...format, range: createRange(0, 0, 0, 1) };
        await rangeFormatter.provideDocumentRangeFormattingEdits(ranged);
        expect(bridge.provideFormattingEdits).toHaveBeenLastCalledWith(2, ranged);

        const [codeActions] = features.codeActionProvider.ordered(TS);
        expect(codeActions.providedCodeActionKinds).toEqual(["source.organizeImports"]);
        const request = { ...REQUEST, range: createRange(0, 0, 0, 1) };
        expect(await codeActions.provideCodeActions(request)).toEqual([{ id: "3.0", title: "fix" }]);
        expect(await codeActions.applyCodeAction("3.0")).toBe(true);
        expect(bridge.applyCodeAction).toHaveBeenCalledWith("3.0");
        expect(features.codeActionProvider.ordered(MD)[0].providedCodeActionKinds).toEqual([]);
    });

    it("folding — прокси в реестре folding-провайдеров, зовёт хост со своим handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "folding", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const request = { uri: REQUEST.uri, languageId: "typescript", versionId: 1 };

        const [folding] = features.foldingRangeProvider.ordered(TS);
        const token = new CancellationTokenSource().token;
        expect(await folding.provideFoldingRanges(request, token)).toEqual([
            { startLine: 5, endLine: 7, isCollapsed: false },
        ]);
        expect(bridge.provideFoldingRanges).toHaveBeenCalledWith(5, request, token);
    });

    it("inlineCompletions — прокси в своём реестре, токен отмены доезжает до хоста", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 9, kind: "inlineCompletions", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const request = { ...REQUEST, triggerKind: 1 as const };

        const [inline] = features.inlineCompletionsProvider.ordered(TS);
        expect(await inline.provideInlineCompletions(request, CancellationTokenNone)).toEqual([
            { insertText: "ghost 9" },
        ]);
        expect(bridge.provideInlineCompletions).toHaveBeenCalledWith(9, request, CancellationTokenNone);
    });

    it("прокси регистрируется под селектором регистрации — чужой язык его не видит", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        bridge.providers = [hover(1, "markdown")];
        bridge.fire();

        expect(features.hoverProvider.has(MD)).toBe(true);
        expect(features.hoverProvider.has(TS)).toBe(false);
    });

    it("снятая регистрация снимает прокси, оставшиеся живут", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const changed = vi.fn();

        bridge.providers = [hover(1), hover(2)];
        bridge.fire();
        features.hoverProvider.onDidChange(changed);
        bridge.providers = [bridge.providers[1]];
        bridge.fire();

        expect(features.hoverProvider.ordered(TS)).toHaveLength(1);
        // Живую регистрацию не перерегистрировали: событие одно — от снятия.
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it("тот же handle с новой регистрацией (рестарт субпроцесса) — прокси пересоздаётся", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        bridge.providers = [hover(0, "markdown")];
        bridge.fire();
        bridge.providers = [hover(0, "typescript")];
        bridge.fire();

        expect(features.hoverProvider.has(MD)).toBe(false);
        expect(features.hoverProvider.has(TS)).toBe(true);
    });

    it("dispose адаптера снимает все прокси и отписывается от моста", () => {
        const bridge = makeBridge();
        bridge.providers = [hover(1), hover(2)];
        const features = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, features);
        expect(bridge.listeners).toBe(1);

        adapter.dispose();

        expect(features.hoverProvider.has(TS)).toBe(false);
        expect(bridge.listeners).toBe(0);
    });
});
