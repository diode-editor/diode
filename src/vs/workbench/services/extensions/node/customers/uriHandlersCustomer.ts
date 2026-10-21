import { Emitter } from "../../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type { IExtensionUriHandlers } from "../../common/extensionUrlHandler.ts";
import { parseWireUriHandlerRegistration } from "../hostWireParsers.ts";

/**
 * Upstream `MainThreadUrls`; deciding “to whom and when” is up to `ExtensionUrlHandler`.
 * The registry lives for one spawn: a revived extension registers its handler again on activation.
 */
export class UriHandlersCustomer extends Disposable implements IExtensionHostCustomer, IExtensionUriHandlers {
    /** Lowercased ids. */
    private live: { readonly rpc: HostRpc; readonly ids: Set<string> } | null = null;
    private readonly onDidRegisterEmitter = this.register(new Emitter<string>());

    public readonly onDidRegister = this.onDidRegisterEmitter.event;

    public has(extensionId: string): boolean {
        return this.live?.ids.has(extensionId.toLowerCase()) === true;
    }

    public async handle(extensionId: string, uri: string): Promise<void> {
        const live = this.live;
        if (!live?.ids.has(extensionId.toLowerCase())) {
            throw new Error(`no uri handler for extension "${extensionId}"`);
        }
        await live.rpc.request("window.handleUri", { extensionId, uri });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const live = { rpc, ids: new Set<string>() };
        this.live = live;
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("window.registerUriHandler", (params): void => {
                const extensionId = parseWireUriHandlerRegistration(params);
                // Stryker disable next-line ConditionalExpression: equivalent — without the `null` check it throws on `toLowerCase` before the write and the event, RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
                if (extensionId === null) return;
                live.ids.add(extensionId.toLowerCase());
                this.onDidRegisterEmitter.fire(extensionId);
            }),
        );
        store.add(
            rpc.handleNotification("window.unregisterUriHandler", (params): void => {
                const extensionId = parseWireUriHandlerRegistration(params);
                // Stryker disable next-line ConditionalExpression: equivalent — `null` is never lowercased, the early return is only for the type
                if (extensionId === null) return;
                live.ids.delete(extensionId.toLowerCase());
            }),
        );
        store.add({
            dispose: () => {
                this.live = null;
            },
        });
        return store;
    }
}
