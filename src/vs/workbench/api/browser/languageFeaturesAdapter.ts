import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILanguageFeaturesService } from "../../../editor/common/services/languageFeatures.ts";
import type { IExtensionLanguageFeaturesBridge } from "../common/iExtensionLanguageFeatures.ts";
import type { IWireLanguageProviderRegistration, WireLanguageFeatureKind } from "../common/wireTypes.ts";

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
                provideHover: (request) => this.bridge.provideHover(handle, request),
            }),
        definition: ({ handle, selector }) =>
            this.languageFeatures.definitionProvider.register(selector, {
                provideDefinition: (request) => this.bridge.provideDefinition(handle, request),
            }),
        references: ({ handle, selector }) =>
            this.languageFeatures.referenceProvider.register(selector, {
                provideReferences: (request) => this.bridge.provideReferences(handle, request),
            }),
        signatureHelp: ({ handle, selector, triggerCharacters = [], retriggerCharacters = [] }) =>
            this.languageFeatures.signatureHelpProvider.register(selector, {
                triggerCharacters,
                retriggerCharacters,
                provideSignatureHelp: (request) => this.bridge.provideSignatureHelp(handle, request),
            }),
        completion: ({ handle, selector, triggerCharacters = [] }) =>
            this.languageFeatures.completionProvider.register(selector, {
                triggerCharacters,
                provideCompletionItems: (request) => this.bridge.provideCompletionItems(handle, request),
                resolveCompletionItem: (id) => this.bridge.resolveCompletionItem(id),
            }),
    };

    private registerProxy(reg: IWireLanguageProviderRegistration): IDisposable {
        return this.proxyFactories[reg.kind](reg);
    }
}
