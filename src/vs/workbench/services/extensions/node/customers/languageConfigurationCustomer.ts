import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILanguageConfigurationService } from "../../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireLanguageConfiguration, parseWireLanguageProviderUnregistration } from "../hostWireParsers.ts";

/**
 * `languages.setLanguageConfiguration` расширений (upstream
 * `MainThreadLanguageFeatures.$setLanguageConfiguration`): слой поверх
 * `language-configuration.json` в сервисе конфигураций ядра. Слои живут ровно
 * один спавн — на смерти субпроцесса снимаются все, ожившее расширение
 * заведёт их заново в своём `activate()`.
 */
export class LanguageConfigurationCustomer implements IExtensionHostCustomer {
    public constructor(private readonly languageConfigurations: Pick<ILanguageConfigurationService, "register">) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const layers = new Map<number, IDisposable>();
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("languages.setLanguageConfiguration", (params) => {
                const parsed = parseWireLanguageConfiguration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (parsed === null) return;
                // Повтор handle — новый слой вместо прежнего, не второй поверх.
                layers.get(parsed.handle)?.dispose();
                layers.set(
                    parsed.handle,
                    this.languageConfigurations.register(parsed.languageId, parsed.configuration),
                );
            }),
        );
        store.add(
            rpc.handleNotification("languages.unsetLanguageConfiguration", (params) => {
                const parsed = parseWireLanguageProviderUnregistration(params);
                // Stryker disable next-line ConditionalExpression: без проверки null падает на `.handle` — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                if (parsed === null) return;
                // Stryker disable next-line OptionalChaining: неизвестный handle без `?.` бросает — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
                layers.get(parsed.handle)?.dispose();
                layers.delete(parsed.handle);
            }),
        );
        store.add({
            dispose: () => {
                for (const layer of layers.values()) layer.dispose();
            },
        });
        return store;
    }
}
