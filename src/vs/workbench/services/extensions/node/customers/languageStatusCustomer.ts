import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILanguageStatusSink } from "../../../../api/common/iLanguageStatusSink.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireLanguageStatusItem, parseWireProviderHandle } from "../hostWireParsers.ts";

/** Upstream `MainThreadLanguages` language status: a dead subprocess never sends `dispose`, so its items go with it. */
export class LanguageStatusCustomer implements IExtensionHostCustomer {
    public constructor(private readonly sink: ILanguageStatusSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("languages.statusItem.update", (params) => {
                const item = parseWireLanguageStatusItem(params);
                if (item === null) return;
                // Stryker disable next-line OptionalChaining: without a sink the access throws inside the notification handler — RpcEndpoint swallows it, the observable result is the same “dropped”
                this.sink?.update(item);
            }),
        );
        store.add(
            rpc.handleNotification("languages.statusItem.dispose", (params) => {
                const removed = parseWireProviderHandle(params);
                // Stryker disable next-line ConditionalExpression: without the null check it throws on `.handle` — RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
                if (removed === null) return;
                // Stryker disable next-line OptionalChaining: see `update` above
                this.sink?.remove(removed.handle);
            }),
        );
        store.add({
            dispose: () => {
                this.sink?.clear();
            },
        });
        return store;
    }
}
