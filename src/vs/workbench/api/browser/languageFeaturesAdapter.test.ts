import { describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { CancellationTokenNone } from "../../../base/common/cancellation.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import type { CodeLens, ICodeLensRequest } from "../../../editor/common/languages/iCodeLensSource.ts";
import type { IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";
import type { IInlayHintsRequest, InlayHint } from "../../../editor/common/languages/iInlayHintsSource.ts";
import type { ITextDocument } from "../../../editor/common/model/iTextDocument.ts";
import { LanguageFeaturesService } from "../../../editor/common/services/languageFeaturesService.ts";
import type { IExtensionLanguageFeaturesBridge } from "../common/iExtensionLanguageFeatures.ts";
import type {
    IWireCodeLens,
    IWireCodeLensList,
    IWireLanguageProviderRegistration,
    WireCodeLensCacheId,
} from "../common/wireTypes.ts";

import { LanguageFeaturesAdapter } from "./languageFeaturesAdapter.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const LENS_RANGE = createRange(1, 0, 1, 3);
const MD = { uri: Uri.file("/w/b.md"), languageId: "markdown" };
const REQUEST: IHoverRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 0,
};

function makeBridge(): IExtensionLanguageFeaturesBridge & {
    providers: IWireLanguageProviderRegistration[];
    fire(): void;
    fireSemanticTokens(handle: number): void;
    fireInlayHints(handle: number): void;
    fireCodeLenses(handle: number): void;
    listeners: number;
} {
    const listeners: (() => void)[] = [];
    const semanticListeners: ((handle: number) => void)[] = [];
    const inlayHintListeners: ((handle: number) => void)[] = [];
    const codeLensListeners: ((handle: number) => void)[] = [];
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
        provideImplementation: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///impl${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        provideTypeDefinition: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///type${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        provideDeclaration: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///decl${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
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
        provideSelectionRanges: vi.fn((handle: number) => Promise.resolve([[createRange(0, 0, 0, handle)]])),
        provideDocumentHighlights: vi.fn((handle: number) =>
            Promise.resolve(handle === 0 ? null : [{ range: createRange(0, 0, 0, handle), kind: 2 }]),
        ),
        provideOnTypeFormattingEdits: vi.fn((handle: number) =>
            Promise.resolve([{ range: createRange(0, 0, 0, handle), text: "x" }]),
        ),
        provideLinkedEditingRanges: vi.fn((handle: number) =>
            Promise.resolve(handle === 0 ? null : { ranges: [createRange(0, 0, 0, handle)], wordPattern: /x/ }),
        ),
        provideDocumentColors: vi.fn((handle: number) =>
            Promise.resolve([{ range: createRange(0, 0, 0, handle), color: { red: 1, green: 0, blue: 0, alpha: 1 } }]),
        ),
        prepareCallHierarchy: vi.fn((handle: number) => Promise.resolve({ sessionId: handle, items: [] })),
        provideCallHierarchyIncomingCalls: vi.fn(() => Promise.resolve([])),
        provideCallHierarchyOutgoingCalls: vi.fn(() => Promise.resolve([])),
        releaseCallHierarchy: vi.fn(),
        prepareTypeHierarchy: vi.fn((handle: number) => Promise.resolve({ sessionId: handle, items: [] })),
        provideTypeHierarchySupertypes: vi.fn(() => Promise.resolve([])),
        provideTypeHierarchySubtypes: vi.fn(() => Promise.resolve([])),
        releaseTypeHierarchy: vi.fn(),
        provideReferences: vi.fn((handle: number) =>
            Promise.resolve([{ uri: `file:///ref${String(handle)}.ts`, range: createRange(0, 0, 0, 1) }]),
        ),
        provideDocumentSemanticTokens: vi.fn((handle: number, _request: unknown, previousResultId: number) =>
            Promise.resolve({ resultId: String(previousResultId + 1), data: new Uint32Array([handle]) }),
        ),
        provideDocumentRangeSemanticTokens: vi.fn((handle: number) =>
            Promise.resolve({ resultId: "0", data: new Uint32Array([handle, 1]) }),
        ),
        releaseDocumentSemanticTokens: vi.fn((_handle: number, _resultId: number): void => undefined),
        onDidChangeSemanticTokens: (cb: (handle: number) => void) => {
            semanticListeners.push(cb);
            return {
                dispose: () => {
                    semanticListeners.splice(semanticListeners.indexOf(cb), 1);
                },
            };
        },
        fireSemanticTokens: (handle: number) => {
            for (const cb of [...semanticListeners]) cb(handle);
        },
        provideInlayHints: vi.fn(
            (handle: number, _request: IInlayHintsRequest, _token?: ICancellationToken): Promise<InlayHint[] | null> =>
                Promise.resolve(handle === 0 ? null : [{ position: { line: 0, character: handle }, label: "hint" }]),
        ),
        onDidChangeInlayHints: (cb: (handle: number) => void) => {
            inlayHintListeners.push(cb);
            return {
                dispose: () => {
                    inlayHintListeners.splice(inlayHintListeners.indexOf(cb), 1);
                },
            };
        },
        fireInlayHints: (handle: number) => {
            for (const cb of [...inlayHintListeners]) cb(handle);
        },
        provideCodeLenses: vi.fn(
            (
                handle: number,
                _request: ICodeLensRequest,
                _token?: ICancellationToken,
            ): Promise<IWireCodeLensList | null> =>
                Promise.resolve(
                    handle === 0
                        ? null
                        : {
                              cacheId: 40,
                              lenses: [
                                  { cacheId: [40, 0], range: LENS_RANGE, command: { id: "run", title: "Run" } },
                                  { cacheId: [40, 1], range: LENS_RANGE },
                              ],
                          },
                ),
        ),
        resolveCodeLens: vi.fn(
            (
                _handle: number,
                cacheId: WireCodeLensCacheId,
                _token?: ICancellationToken,
            ): Promise<IWireCodeLens | null> =>
                Promise.resolve(
                    cacheId[1] === 9 ? null : { cacheId, range: LENS_RANGE, command: { id: "late", title: "Late" } },
                ),
        ),
        releaseCodeLenses: vi.fn((_handle: number, _cacheId: number): void => undefined),
        executeCodeLensCommand: vi.fn(
            (_handle: number, _cacheId: WireCodeLensCacheId): Promise<void> => Promise.resolve(),
        ),
        onDidChangeCodeLenses: (cb: (handle: number) => void) => {
            codeLensListeners.push(cb);
            return {
                dispose: () => {
                    codeLensListeners.splice(codeLensListeners.indexOf(cb), 1);
                },
            };
        },
        fireCodeLenses: (handle: number) => {
            for (const cb of [...codeLensListeners]) cb(handle);
        },
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
    it("callHierarchy: the proxy asks and releases by the provider's handle", async () => {
        const bridge = makeBridge();
        const service = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, service);
        bridge.providers = [{ handle: 5, kind: "callHierarchy", selector: [{ language: "typescript" }] }];
        bridge.fire();
        const [provider] = service.callHierarchyProvider.ordered({
            uri: Uri.file("/a.ts"),
            languageId: "typescript",
        } as never);
        const token = new CancellationTokenSource().token;
        const request = { uri: "file:///a.ts", languageId: "typescript", versionId: 1, line: 0, character: 0 };

        await provider.prepareCallHierarchy(request, token);
        expect(bridge.prepareCallHierarchy).toHaveBeenCalledWith(5, request, token);
        await provider.provideIncomingCalls(40, 2, token);
        expect(bridge.provideCallHierarchyIncomingCalls).toHaveBeenCalledWith(5, 40, 2, token);
        await provider.provideOutgoingCalls(40, 3, token);
        expect(bridge.provideCallHierarchyOutgoingCalls).toHaveBeenCalledWith(5, 40, 3, token);
        provider.releaseCallHierarchy(40);
        expect(bridge.releaseCallHierarchy).toHaveBeenCalledWith(5, 40);
        adapter.dispose();
    });

    it("typeHierarchy: the proxy asks and releases by the provider's handle", async () => {
        const bridge = makeBridge();
        const service = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, service);
        bridge.providers = [{ handle: 5, kind: "typeHierarchy", selector: [{ language: "typescript" }] }];
        bridge.fire();
        const [provider] = service.typeHierarchyProvider.ordered({
            uri: Uri.file("/a.ts"),
            languageId: "typescript",
        } as never);
        const token = new CancellationTokenSource().token;
        const request = { uri: "file:///a.ts", languageId: "typescript", versionId: 1, line: 0, character: 0 };

        await provider.prepareTypeHierarchy(request, token);
        expect(bridge.prepareTypeHierarchy).toHaveBeenCalledWith(5, request, token);
        await provider.provideSupertypes(40, 2, token);
        expect(bridge.provideTypeHierarchySupertypes).toHaveBeenCalledWith(5, 40, 2, token);
        await provider.provideSubtypes(40, 3, token);
        expect(bridge.provideTypeHierarchySubtypes).toHaveBeenCalledWith(5, 40, 3, token);
        provider.releaseTypeHierarchy(40);
        expect(bridge.releaseTypeHierarchy).toHaveBeenCalledWith(5, 40);
        adapter.dispose();
    });

    it("picks up registrations declared before the adapter is created", async () => {
        const bridge = makeBridge();
        bridge.providers = [hover(1)];
        const features = new LanguageFeaturesService();

        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.hoverProvider.ordered(TS);
        const token = new CancellationTokenSource().token;
        expect(await provider.provideHover(REQUEST, token)).toEqual({ contents: ["handle 1"] });
        // The request token reaches the host; cancellation goes to the extension's provider with it.
        expect(bridge.provideHover).toHaveBeenCalledWith(1, REQUEST, token);
    });

    it("definition and references: proxies in their registries call the host with their handle", async () => {
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

    it("implementation: the proxy lands in its own registry and calls the host with its handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 6, kind: "implementation", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        expect(features.definitionProvider.has(TS)).toBe(false);

        const [implementation] = features.implementationProvider.ordered(TS);
        const token = new CancellationTokenSource().token;
        expect(await implementation.provideImplementation(REQUEST, token)).toEqual([
            { uri: "file:///impl6.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(bridge.provideImplementation).toHaveBeenCalledWith(6, REQUEST, token);
    });

    it("type definition and declaration: each proxy lands in its own registry with its handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 7, kind: "typeDefinition", selector: [{ language: "typescript" }] },
            { handle: 8, kind: "declaration", selector: [{ language: "typescript" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        expect(features.definitionProvider.has(TS)).toBe(false);
        expect(features.implementationProvider.has(TS)).toBe(false);

        const [typeDefinition] = features.typeDefinitionProvider.ordered(TS);
        const [declaration] = features.declarationProvider.ordered(TS);
        const token = new CancellationTokenSource().token;
        expect(await typeDefinition.provideTypeDefinition(REQUEST, token)).toEqual([
            { uri: "file:///type7.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(await declaration.provideDeclaration(REQUEST, token)).toEqual([
            { uri: "file:///decl8.ts", range: createRange(0, 0, 0, 1) },
        ]);
        expect(bridge.provideTypeDefinition).toHaveBeenCalledWith(7, REQUEST, token);
        expect(bridge.provideDeclaration).toHaveBeenCalledWith(8, REQUEST, token);
    });

    it("rename: proxy in its registry, both methods call the host with its handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 9, kind: "rename", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.renameProvider.ordered(TS);
        expect(await provider.prepareRename(REQUEST)).toEqual({ kind: "name", name: "symbol9" });
        expect(bridge.prepareRename).toHaveBeenCalledWith(9, REQUEST);

        expect(await provider.provideRenameEdits(REQUEST, "ok9")).toEqual({ applied: true });
        expect(bridge.provideRenameEdits).toHaveBeenCalledWith(9, REQUEST, "ok9");
        // The new name arrives verbatim: the provider does not apply someone else's name.
        expect(await provider.provideRenameEdits(REQUEST, "other")).toEqual({ applied: false });
    });

    it("selectionRange: proxy in its registry calls the host with its handle and token", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 7, kind: "selectionRange", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.selectionRangeProvider.ordered(TS);
        const request = {
            uri: "file:///w/a.ts",
            languageId: "typescript",
            versionId: 1,
            positions: [{ line: 0, character: 1 }],
        };
        const token = new CancellationTokenSource().token;
        expect(await provider.provideSelectionRanges(request, token)).toEqual([[createRange(0, 0, 0, 7)]]);
        expect(bridge.provideSelectionRanges).toHaveBeenCalledWith(7, request, token);
    });

    it("documentHighlight: the provider goes to the registry and asks the bridge by its handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "documentHighlight", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.documentHighlightProvider.ordered(TS);
        const request = {
            uri: "file:///w/a.ts",
            languageId: "typescript",
            versionId: 1,
            position: { line: 0, character: 1 },
        };
        const token = new CancellationTokenSource().token;
        expect(await provider.provideDocumentHighlights(request, token)).toEqual([
            { range: createRange(0, 0, 0, 5), kind: 2 },
        ]);
        expect(bridge.provideDocumentHighlights).toHaveBeenCalledWith(5, request, token);

        bridge.providers = [];
        bridge.fire();
        expect(features.documentHighlightProvider.has(TS)).toBe(false);
        adapter.dispose();
    });

    it("onTypeFormatting: the triggers reach the registry and the bridge is asked by its handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            {
                handle: 5,
                kind: "onTypeFormatting",
                selector: [{ language: "typescript" }],
                triggerCharacters: [";", "\n"],
            },
            { handle: 6, kind: "onTypeFormatting", selector: [{ language: "go" }] },
        ];
        const features = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.onTypeFormattingEditProvider.ordered(TS);
        expect(provider.triggerCharacters).toEqual([";", "\n"]);
        const [bare] = features.onTypeFormattingEditProvider.ordered({ uri: TS.uri, languageId: "go" });
        expect(bare.triggerCharacters).toEqual([]);

        const request = {
            uri: "file:///w/a.ts",
            languageId: "typescript",
            versionId: 1,
            position: { line: 0, character: 1 },
            ch: ";",
            tabSize: 4,
            insertSpaces: true,
        };
        const token = new CancellationTokenSource().token;
        expect(await provider.provideOnTypeFormattingEdits(request, token)).toEqual([
            { range: createRange(0, 0, 0, 5), text: "x" },
        ]);
        expect(bridge.provideOnTypeFormattingEdits).toHaveBeenCalledWith(5, request, token);
        adapter.dispose();
    });

    it("linkedEditingRange: the provider goes to the registry and asks the bridge by its handle", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "linkedEditingRange", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.linkedEditingRangeProvider.ordered(TS);
        const request = {
            uri: "file:///w/a.ts",
            languageId: "typescript",
            versionId: 1,
            position: { line: 0, character: 1 },
        };
        const token = new CancellationTokenSource().token;
        expect(await provider.provideLinkedEditingRanges(request, token)).toEqual({
            ranges: [createRange(0, 0, 0, 5)],
            wordPattern: /x/,
        });
        expect(bridge.provideLinkedEditingRanges).toHaveBeenCalledWith(5, request, token);

        bridge.providers = [];
        bridge.fire();
        expect(features.linkedEditingRangeProvider.has(TS)).toBe(false);
        adapter.dispose();
    });

    it("color: a proxy in its registry calls the host with its handle and token", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "color", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        const adapter = new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.colorProvider.ordered(TS);
        const request = {
            uri: "file:///w/a.ts",
            languageId: "typescript",
            versionId: 1,
            document: {} as ITextDocument,
        };
        const token = new CancellationTokenSource().token;
        expect(await provider.provideDocumentColors(request, token)).toEqual([
            { range: createRange(0, 0, 0, 5), color: { red: 1, green: 0, blue: 0, alpha: 1 } },
        ]);
        expect(bridge.provideDocumentColors).toHaveBeenCalledWith(5, request, token);

        bridge.providers = [];
        bridge.fire();
        expect(features.colorProvider.has(TS)).toBe(false);
        adapter.dispose();
    });

    it("inlayHints: a proxy in its registry asks the host about the model, with its handle and token", async () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 5, kind: "inlayHints", selector: [{ language: "typescript" }] },
            { handle: 0, kind: "inlayHints", selector: [{ language: "typescript" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const providers = features.inlayHintsProvider.ordered(TS);
        expect(providers).toHaveLength(2);
        const model = { ...TS, document: { versionId: 3 } as ITextDocument };
        const range = createRange(0, 0, 4, 0);
        const token = new CancellationTokenSource().token;
        const answers = await Promise.all(providers.map(async (p) => p.provideInlayHints(model, range, token)));

        expect(bridge.provideInlayHints).toHaveBeenCalledWith(
            5,
            { uri: TS.uri.toString(), languageId: TS.languageId, versionId: 3, range },
            token,
        );
        expect(answers.find((list) => list === null)).toBeNull();
        const list = answers.find((answer) => answer !== null && answer !== undefined);
        expect(list?.hints).toEqual([{ position: { line: 0, character: 5 }, label: "hint" }]);
        expect(() => list?.dispose()).not.toThrow();
    });

    it("inlayHints: the change event reaches the provider of its handle; none without hasOnDidChange", () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 1, kind: "inlayHints", selector: [{ language: "typescript" }], hasOnDidChange: true },
            { handle: 2, kind: "inlayHints", selector: [{ language: "python" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.inlayHintsProvider.ordered(TS);
        const listener = vi.fn();
        const subscription = provider.onDidChangeInlayHints?.(listener);
        bridge.fireInlayHints(9);
        expect(listener).not.toHaveBeenCalled();
        bridge.fireInlayHints(1);
        expect(listener).toHaveBeenCalledOnce();
        subscription?.dispose();
        bridge.fireInlayHints(1);
        expect(listener).toHaveBeenCalledOnce();

        const [silent] = features.inlayHintsProvider.ordered({ ...TS, languageId: "python" });
        expect(silent.onDidChangeInlayHints).toBeUndefined();
    });

    it("codeLens: the document and token go to the bridge of its handle, the lenses come with the address, nothing to run on their own", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "codeLens", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.codeLensProvider.ordered(TS);
        const model = { ...TS, document: { versionId: 3 } as ITextDocument };
        const token = new CancellationTokenSource().token;
        const list = await provider.provideCodeLenses(model, token);

        expect(bridge.provideCodeLenses).toHaveBeenCalledWith(
            5,
            { uri: TS.uri.toString(), languageId: TS.languageId, versionId: 3 },
            token,
        );
        expect(list?.lenses).toEqual([
            {
                cacheId: [40, 0],
                range: LENS_RANGE,
                command: { id: "run", title: "Run", run: expect.any(Function) as () => Promise<void> },
            },
            { cacheId: [40, 1], range: LENS_RANGE },
        ]);
    });

    it("codeLens: no answer from the bridge is no list", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 0, kind: "codeLens", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const [provider] = features.codeLensProvider.ordered(TS);
        const model = { ...TS, document: { versionId: 3 } as ITextDocument };
        expect(await provider.provideCodeLenses(model, CancellationTokenNone)).toBeNull();
        expect(bridge.releaseCodeLenses).not.toHaveBeenCalled();
    });

    it("codeLens: disposing the list releases its session, the command runs by the address of the lens", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "codeLens", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const [provider] = features.codeLensProvider.ordered(TS);
        const model = { ...TS, document: { versionId: 3 } as ITextDocument };
        const list = await provider.provideCodeLenses(model, CancellationTokenNone);

        await list?.lenses[0].command?.run?.();
        expect(bridge.executeCodeLensCommand).toHaveBeenCalledWith(5, [40, 0]);

        expect(bridge.releaseCodeLenses).not.toHaveBeenCalled();
        list?.dispose();
        expect(bridge.releaseCodeLenses).toHaveBeenCalledWith(5, 40);
    });

    it("codeLens: a resolve goes by the address of the lens, its command runs by the same address", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "codeLens", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const [provider] = features.codeLensProvider.ordered(TS);
        const model = { ...TS, document: { versionId: 3 } as ITextDocument };
        const list = await provider.provideCodeLenses(model, CancellationTokenNone);
        const token = new CancellationTokenSource().token;
        const lens = list?.lenses[1];
        if (lens === undefined) throw new Error("no lens");

        const resolved = await provider.resolveCodeLens?.(model, lens, token);

        expect(bridge.resolveCodeLens).toHaveBeenCalledWith(5, [40, 1], token);
        expect(resolved?.command?.title).toBe("Late");
        await resolved?.command?.run?.();
        expect(bridge.executeCodeLensCommand).toHaveBeenCalledWith(5, [40, 1]);
    });

    it("codeLens: a failed resolve is null", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 5, kind: "codeLens", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const [provider] = features.codeLensProvider.ordered(TS);
        const model = { ...TS, document: { versionId: 3 } as ITextDocument };
        const lens = { range: LENS_RANGE, cacheId: [40, 9] } as CodeLens;
        expect(await provider.resolveCodeLens?.(model, lens, CancellationTokenNone)).toBeNull();
    });

    it("codeLens: the change event reaches the provider of its handle; none without hasOnDidChange", () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 1, kind: "codeLens", selector: [{ language: "typescript" }], hasOnDidChange: true },
            { handle: 2, kind: "codeLens", selector: [{ language: "python" }] },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        const [provider] = features.codeLensProvider.ordered(TS);
        const listener = vi.fn();
        const subscription = provider.onDidChange?.(listener);
        bridge.fireCodeLenses(9);
        expect(listener).not.toHaveBeenCalled();
        bridge.fireCodeLenses(1);
        expect(listener).toHaveBeenCalledOnce();
        subscription?.dispose();
        bridge.fireCodeLenses(1);
        expect(listener).toHaveBeenCalledOnce();

        const [silent] = features.codeLensProvider.ordered({ ...TS, languageId: "python" });
        expect(silent.onDidChange).toBeUndefined();
    });

    it("signatureHelp: triggers come from registration metadata, empty without metadata", async () => {
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

    it("completion: triggers from metadata, provide with handle, resolve by item id", async () => {
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

    it("formatting/rangeFormatting/codeActions: proxies in their registries, kinds from metadata", async () => {
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
        const token = new CancellationTokenSource().token;

        const [documentFormatter] = features.documentFormattingEditProvider.ordered(TS);
        expect(await documentFormatter.provideDocumentFormattingEdits(format, token)).toEqual([
            { range: createRange(0, 0, 0, 0), text: "f1" },
        ]);
        expect(bridge.provideFormattingEdits).toHaveBeenLastCalledWith(1, format, token);
        const [rangeFormatter] = features.documentRangeFormattingEditProvider.ordered(TS);
        const ranged = { ...format, range: createRange(0, 0, 0, 1) };
        await rangeFormatter.provideDocumentRangeFormattingEdits(ranged, token);
        expect(bridge.provideFormattingEdits).toHaveBeenLastCalledWith(2, ranged, token);

        const [codeActions] = features.codeActionProvider.ordered(TS);
        expect(codeActions.providedCodeActionKinds).toEqual(["source.organizeImports"]);
        const request = { ...REQUEST, range: createRange(0, 0, 0, 1) };
        expect(await codeActions.provideCodeActions(request, token)).toEqual([{ id: "3.0", title: "fix" }]);
        expect(bridge.provideCodeActions).toHaveBeenCalledWith(3, request, token);
        expect(await codeActions.applyCodeAction("3.0")).toBe(true);
        expect(bridge.applyCodeAction).toHaveBeenCalledWith("3.0", undefined);
        await codeActions.applyCodeAction("3.0", { onSave: true });
        expect(bridge.applyCodeAction).toHaveBeenLastCalledWith("3.0", { onSave: true });
        expect(features.codeActionProvider.ordered(MD)[0].providedCodeActionKinds).toEqual([]);
    });

    it("folding: proxy in the folding provider registry calls the host with its handle", async () => {
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

    it("inlineCompletions: proxy in its registry, cancellation token reaches the host", async () => {
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

    it("semanticTokens: proxy with legend; string resultId ↔ number on the wire, null is 0", async () => {
        const bridge = makeBridge();
        const legend = { tokenTypes: ["class"], tokenModifiers: ["declaration"] };
        bridge.providers = [{ handle: 7, kind: "semanticTokens", selector: [{ language: "typescript" }], legend }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const [provider] = features.documentSemanticTokensProvider.ordered(TS);
        expect(provider.getLegend()).toBe(legend);
        expect(provider.onDidChange).toBeUndefined();

        const token = new CancellationTokenSource().token;
        const request = { uri: REQUEST.uri, languageId: "typescript", versionId: 1 };
        expect(await provider.provideDocumentSemanticTokens(request, null, token)).toEqual({
            resultId: "1",
            data: new Uint32Array([7]),
        });
        expect(bridge.provideDocumentSemanticTokens).toHaveBeenLastCalledWith(7, request, 0, token);
        await provider.provideDocumentSemanticTokens(request, "12", token);
        expect(bridge.provideDocumentSemanticTokens).toHaveBeenLastCalledWith(7, request, 12, token);

        provider.releaseDocumentSemanticTokens("5");
        provider.releaseDocumentSemanticTokens(undefined);
        provider.releaseDocumentSemanticTokens("");
        expect(bridge.releaseDocumentSemanticTokens).toHaveBeenCalledOnce();
        expect(bridge.releaseDocumentSemanticTokens).toHaveBeenCalledWith(7, 5);
    });

    it("rangeSemanticTokens: proxy in its registry; empty legend without one", async () => {
        const bridge = makeBridge();
        bridge.providers = [{ handle: 3, kind: "rangeSemanticTokens", selector: [{ language: "typescript" }] }];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        expect(features.documentSemanticTokensProvider.has(TS)).toBe(false);
        const [provider] = features.documentRangeSemanticTokensProvider.ordered(TS);
        expect(provider.getLegend()).toEqual({ tokenTypes: [], tokenModifiers: [] });
        // Without hasOnDidChange there is no event: the core does not subscribe needlessly.
        expect(provider.onDidChange).toBeUndefined();
        const request = { uri: REQUEST.uri, languageId: "typescript", versionId: 1, range: createRange(0, 0, 1, 0) };
        expect(await provider.provideDocumentRangeSemanticTokens(request, CancellationTokenNone)).toEqual({
            resultId: "0",
            data: new Uint32Array([3, 1]),
        });
        expect(bridge.provideDocumentRangeSemanticTokens).toHaveBeenCalledWith(3, request, CancellationTokenNone);
    });

    it("proxy onDidChange fires only with hasOnDidChange and only for its own handle", () => {
        const bridge = makeBridge();
        bridge.providers = [
            { handle: 1, kind: "semanticTokens", selector: [{ language: "typescript" }], hasOnDidChange: true },
            { handle: 2, kind: "rangeSemanticTokens", selector: [{ language: "typescript" }], hasOnDidChange: true },
        ];
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);
        const [doc] = features.documentSemanticTokensProvider.ordered(TS);
        const [range] = features.documentRangeSemanticTokensProvider.ordered(TS);
        const seen: string[] = [];
        const subscription = doc.onDidChange?.(() => seen.push("doc"));
        range.onDidChange?.(() => seen.push("range"));
        bridge.fireSemanticTokens(2);
        bridge.fireSemanticTokens(1);
        bridge.fireSemanticTokens(9);
        expect(seen).toEqual(["range", "doc"]);
        subscription?.dispose();
        bridge.fireSemanticTokens(1);
        expect(seen).toEqual(["range", "doc"]);
    });

    it("proxy registers under the registration selector, another language does not see it", () => {
        const bridge = makeBridge();
        const features = new LanguageFeaturesService();
        new LanguageFeaturesAdapter(bridge, features);

        bridge.providers = [hover(1, "markdown")];
        bridge.fire();

        expect(features.hoverProvider.has(MD)).toBe(true);
        expect(features.hoverProvider.has(TS)).toBe(false);
    });

    it("removed registration removes its proxy, the rest stay", () => {
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
        // The live registration was not re-registered: there is one event, from the removal.
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it("same handle with a new registration (subprocess restart) recreates the proxy", () => {
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

    it("adapter dispose removes all proxies and unsubscribes from the bridge", () => {
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
