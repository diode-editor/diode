import { Emitter } from "../../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import {
    type IWireLanguageProviderRegistration,
    parseWireLanguageProviderRegistration,
    parseWireLanguageProviderUnregistration,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/**
 * Языковые провайдеры расширений (мост под `ILanguageFeaturesService`):
 * субпроцесс объявляет каждого с handle и селектором, ядро само решает, кого
 * спрашивать. Реестр провайдеров живёт один спавн: провайдеры умирают вместе
 * с субпроцессом, и адаптер снимает их прокси из реестра ядра.
 */
export class LanguageFeaturesCustomer extends Disposable implements IExtensionHostCustomer {
    /** Провайдеры текущего спавна по handle; пусто — спавна нет или он ничего не объявил. */
    private readonly providers = new Map<number, IWireLanguageProviderRegistration>();
    private readonly onProvidersChangedEmitter = this.register(new Emitter<void>());

    /** Состав провайдеров изменился: регистрация, снятие или смерть субпроцесса. */
    public readonly onProvidersChanged = this.onProvidersChangedEmitter.event;

    /**
     * Языковые провайдеры, объявленные субпроцессом (`languages.register`).
     * Потребитель — адаптер, регистрирующий их прокси в реестре ядра.
     */
    public getProviders(): readonly IWireLanguageProviderRegistration[] {
        return [...this.providers.values()];
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("languages.register", (params) => {
                const registration = parseWireLanguageProviderRegistration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (registration === null) return;
                this.providers.set(registration.handle, registration);
                this.onProvidersChangedEmitter.fire();
            }),
        );
        store.add(
            rpc.handleNotification("languages.unregister", (params) => {
                const unregistration = parseWireLanguageProviderUnregistration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` до события — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (unregistration === null || !this.providers.delete(unregistration.handle)) return;
                this.onProvidersChangedEmitter.fire();
            }),
        );
        // Провайдеры умерли вместе с субпроцессом: адаптер снимет их прокси из
        // реестра ядра, и запросы к мёртвым handle не уйдут.
        store.add({
            dispose: () => {
                if (this.providers.size === 0) return;
                this.providers.clear();
                this.onProvidersChangedEmitter.fire();
            },
        });
        return store;
    }
}
