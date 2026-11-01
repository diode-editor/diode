import type { Event } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.ts";
import type { IExtensionLanguageFeaturesBridge } from "../common/iExtensionLanguageFeatures.ts";
import type {
    IWireLanguageProviderRegistration,
    IWireSemanticTokensLegend,
    WireLanguageFeatureKind,
} from "../common/wireTypes.ts";

const EMPTY_LEGEND: IWireSemanticTokensLegend = { tokenTypes: [], tokenModifiers: [] };

interface ILiveRegistration {
    readonly source: IWireLanguageProviderRegistration;
    readonly disposable: IDisposable;
}

/**
 * Like upstream `MainThreadLanguageFeatures`. The set is rebuilt on the bridge event, not from
 * deltas: the adapter may appear after the first registrations, and subprocess death is one event.
 */
export class LanguageFeaturesAdapter extends Disposable {
    private readonly registrations = new Map<number, ILiveRegistration>();

    public constructor(
        private readonly bridge: IExtensionLanguageFeaturesBridge,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        this.register(
            this.bridge.onLanguageProvidersChanged(() => {
                this.sync();
            }),
        );
        this.register({
            dispose: () => {
                for (const live of this.registrations.values()) live.disposable.dispose();
            },
        });
        // The subprocess may have declared providers before the adapter was created.
        this.sync();
    }

    private sync(): void {
        const wanted = new Map(this.bridge.getLanguageProviders().map((reg) => [reg.handle, reg]));

        for (const [handle, live] of this.registrations) {
            // The same handle with a different registration (the subprocess restarted and
            // hands out handles anew): drop the old proxy and install a new one.
            if (wanted.get(handle) === live.source) continue;
            live.disposable.dispose();
            this.registrations.delete(handle);
        }

        for (const [handle, reg] of wanted) {
            if (this.registrations.has(handle)) continue;
            this.registrations.set(handle, { source: reg, disposable: this.registerProxy(reg) });
        }
    }

    private readonly proxyFactories: Readonly<
        Record<WireLanguageFeatureKind, (reg: IWireLanguageProviderRegistration) => IDisposable>
    > = {
        hover: ({ handle, selector }) =>
            this.languageFeatures.hoverProvider.register(selector, {
                provideHover: (request, token) => this.bridge.provideHover(handle, request, token),
            }),
        definition: ({ handle, selector }) =>
            this.languageFeatures.definitionProvider.register(selector, {
                provideDefinition: (request, token) => this.bridge.provideDefinition(handle, request, token),
            }),
        implementation: ({ handle, selector }) =>
            this.languageFeatures.implementationProvider.register(selector, {
                provideImplementation: (request, token) => this.bridge.provideImplementation(handle, request, token),
            }),
        references: ({ handle, selector }) =>
            this.languageFeatures.referenceProvider.register(selector, {
                provideReferences: (request, token) => this.bridge.provideReferences(handle, request, token),
            }),
        signatureHelp: ({ handle, selector, triggerCharacters = [], retriggerCharacters = [] }) =>
            this.languageFeatures.signatureHelpProvider.register(selector, {
                triggerCharacters,
                retriggerCharacters,
                provideSignatureHelp: (request, token) => this.bridge.provideSignatureHelp(handle, request, token),
            }),
        completion: ({ handle, selector, triggerCharacters = [] }) =>
            this.languageFeatures.completionProvider.register(selector, {
                triggerCharacters,
                provideCompletionItems: (request, token) => this.bridge.provideCompletionItems(handle, request, token),
                resolveCompletionItem: (id) => this.bridge.resolveCompletionItem(id),
            }),
        formatting: ({ handle, selector }) =>
            this.languageFeatures.documentFormattingEditProvider.register(selector, {
                provideDocumentFormattingEdits: (request, token) =>
                    this.bridge.provideFormattingEdits(handle, request, token),
            }),
        rangeFormatting: ({ handle, selector }) =>
            this.languageFeatures.documentRangeFormattingEditProvider.register(selector, {
                provideDocumentRangeFormattingEdits: (request, token) =>
                    this.bridge.provideFormattingEdits(handle, request, token),
            }),
        codeActions: ({ handle, selector, providedCodeActionKinds = [] }) =>
            this.languageFeatures.codeActionProvider.register(selector, {
                providedCodeActionKinds,
                provideCodeActions: (request, token) => this.bridge.provideCodeActions(handle, request, token),
                applyCodeAction: (id, options) => this.bridge.applyCodeAction(id, options),
            }),
        folding: ({ handle, selector }) =>
            this.languageFeatures.foldingRangeProvider.register(selector, {
                provideFoldingRanges: (request, token) => this.bridge.provideFoldingRanges(handle, request, token),
            }),
        inlineCompletions: ({ handle, selector }) =>
            this.languageFeatures.inlineCompletionsProvider.register(selector, {
                provideInlineCompletions: (request, token) =>
                    this.bridge.provideInlineCompletions(handle, request, token),
            }),
        rename: ({ handle, selector }) =>
            this.languageFeatures.renameProvider.register(selector, {
                prepareRename: (request) => this.bridge.prepareRename(handle, request),
                provideRenameEdits: (request, newName) => this.bridge.provideRenameEdits(handle, request, newName),
            }),
        selectionRange: ({ handle, selector }) =>
            this.languageFeatures.selectionRangeProvider.register(selector, {
                provideSelectionRanges: (request, token) => this.bridge.provideSelectionRanges(handle, request, token),
            }),
        color: ({ handle, selector }) =>
            this.languageFeatures.colorProvider.register(selector, {
                provideDocumentColors: (request, token) => this.bridge.provideDocumentColors(handle, request, token),
            }),
        // The hints die with their answer: there is no resolve cache in the subprocess to release.
        inlayHints: ({ handle, selector, hasOnDidChange }) =>
            this.languageFeatures.inlayHintsProvider.register(selector, {
                ...(hasOnDidChange === true ? { onDidChangeInlayHints: this.inlayHintsChangeEvent(handle) } : {}),
                provideInlayHints: async (model, range, token) => {
                    const request = {
                        uri: model.uri.toString(),
                        languageId: model.languageId,
                        versionId: model.document.versionId,
                        range,
                    };
                    const hints = await this.bridge.provideInlayHints(handle, request, token);
                    return hints === null ? null : { hints, dispose: () => undefined };
                },
            }),
        // Upstream `MainThreadDocumentSemanticTokensProvider`: the result id is a
        // string in the core and a number on the wire; "no previous" is 0.
        semanticTokens: ({ handle, selector, legend = EMPTY_LEGEND, hasOnDidChange }) =>
            this.languageFeatures.documentSemanticTokensProvider.register(selector, {
                ...(hasOnDidChange === true ? { onDidChange: this.semanticTokensChangeEvent(handle) } : {}),
                getLegend: () => legend,
                provideDocumentSemanticTokens: (request, lastResultId, token) =>
                    this.bridge.provideDocumentSemanticTokens(
                        handle,
                        request,
                        lastResultId === null ? 0 : parseInt(lastResultId, 10),
                        token,
                    ),
                releaseDocumentSemanticTokens: (resultId) => {
                    if (resultId !== undefined && resultId !== "") {
                        this.bridge.releaseDocumentSemanticTokens(handle, parseInt(resultId, 10));
                    }
                },
            }),
        rangeSemanticTokens: ({ handle, selector, legend = EMPTY_LEGEND, hasOnDidChange }) =>
            this.languageFeatures.documentRangeSemanticTokensProvider.register(selector, {
                ...(hasOnDidChange === true ? { onDidChange: this.semanticTokensChangeEvent(handle) } : {}),
                getLegend: () => legend,
                provideDocumentRangeSemanticTokens: (request, token) =>
                    this.bridge.provideDocumentRangeSemanticTokens(handle, request, token),
            }),
    };

    private semanticTokensChangeEvent(handle: number): Event<void> {
        return (listener) =>
            this.bridge.onDidChangeSemanticTokens((changed) => {
                if (changed === handle) listener();
            });
    }

    private inlayHintsChangeEvent(handle: number): Event<void> {
        return (listener) =>
            this.bridge.onDidChangeInlayHints((changed) => {
                if (changed === handle) listener();
            });
    }

    private registerProxy(reg: IWireLanguageProviderRegistration): IDisposable {
        return this.proxyFactories[reg.kind](reg);
    }
}
