import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILanguageConfigurationService } from "../../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireLanguageConfiguration, parseWireLanguageProviderUnregistration } from "../hostWireParsers.ts";

/**
 * upstream `MainThreadLanguageFeatures.$setLanguageConfiguration`: a layer on top of
 * `language-configuration.json`. Layers live for one spawn — a revived extension
 * registers them again in `activate()`.
 */
export class LanguageConfigurationCustomer implements IExtensionHostCustomer {
    public constructor(private readonly languageConfigurations: Pick<ILanguageConfigurationService, "register">) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const layers = new Map<number, IDisposable>();
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("languages.setLanguageConfiguration", (params) => {
                const parsed = parseWireLanguageConfiguration(params);
                // Stryker disable next-line ConditionalExpression: without the null check it throws on `.handle` — RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
                if (parsed === null) return;
                // A repeated handle replaces the previous layer instead of stacking a second one.
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
                // Stryker disable next-line ConditionalExpression: without the null check it throws on `.handle` — RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
                if (parsed === null) return;
                // Stryker disable next-line OptionalChaining: an unknown handle without `?.` throws — RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
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
