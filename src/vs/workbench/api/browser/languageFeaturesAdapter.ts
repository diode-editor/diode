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
 * Держит в {@link ILanguageFeaturesService} прокси языковых провайдеров
 * субпроцесса (upstream `MainThreadLanguageFeatures`): на каждую регистрацию
 * `languages.register` — прокси в реестре нужной фичи, который зовёт хост с
 * handle провайдера; снятие или смерть субпроцесса снимает прокси. Живёт в слое
 * Extensions — реестр ядра про host не знает.
 *
 * Набор регистраций пересобирается по событию моста, а не по дельтам: адаптер
 * может появиться позже первых регистраций, а смерть субпроцесса приходит
 * одним событием «всё снято».
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
        // Субпроцесс мог объявить провайдеров до создания адаптера.
        this.sync();
    }

    /** Приводит прокси в реестрах к текущему списку регистраций субпроцесса. */
    private sync(): void {
        const wanted = new Map(this.bridge.getLanguageProviders().map((reg) => [reg.handle, reg]));

        for (const [handle, live] of this.registrations) {
            // Тот же handle с другой регистрацией (субпроцесс перезапущен и
            // раздаёт handle заново) — снимаем старый прокси и ставим новый.
            if (wanted.get(handle) === live.source) continue;
            live.disposable.dispose();
            this.registrations.delete(handle);
        }

        for (const [handle, reg] of wanted) {
            if (this.registrations.has(handle)) continue;
            this.registrations.set(handle, { source: reg, disposable: this.registerProxy(reg) });
        }
    }

    /** По фабрике прокси на вид фичи: реестр нужной фичи + вызов хоста с handle. */
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
                applyCodeAction: (id) => this.bridge.applyCodeAction(id),
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
        // Upstream `MainThreadDocumentSemanticTokensProvider`: id ответа ходит
        // строкой в ядре и числом по проводу, «нет прошлого» — 0.
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

    /** `onDidChangeSemanticTokens` одного провайдера — срез общего события моста по handle. */
    private semanticTokensChangeEvent(handle: number): Event<void> {
        return (listener) =>
            this.bridge.onDidChangeSemanticTokens((changed) => {
                if (changed === handle) listener();
            });
    }

    private registerProxy(reg: IWireLanguageProviderRegistration): IDisposable {
        return this.proxyFactories[reg.kind](reg);
    }
}
