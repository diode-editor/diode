import type { ICancellationToken } from "../../../../../base/common/cancellation.ts";
import { RunOnceScheduler } from "../../../../../base/common/async.ts";
import { Emitter } from "../../../../../base/common/event.ts";
import { DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IWireFileDecoration } from "../../../../api/common/wireTypes.ts";
import type { IDecorationData, IDecorationsService } from "../../../decorations/common/decorations.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireFileDecorationProvider,
    parseWireFileDecorationProviderHandle,
    parseWireFileDecorationReply,
    parseWireFileDecorationsChanged,
} from "../hostWireParsers.ts";

interface IQueuedRequest {
    readonly uri: string;
    readonly resolve: (data: IWireFileDecoration | undefined) => void;
    readonly reject: (err: unknown) => void;
}

/** Upstream `DecorationRequestsQueue`: the requests of one tick go to the provider as one batch. */
class DecorationRequestsQueue implements IDisposable {
    private nextId = 0;
    private requests = new Map<number, IQueuedRequest>();
    /** Dropped with the provider: a batch due after its removal is never sent. */
    private readonly scheduler = new RunOnceScheduler(() => {
        this.flush();
    }, 0);

    public constructor(
        private readonly rpc: HostRpc,
        private readonly handle: number,
    ) {}

    public enqueue(uri: Uri, token: ICancellationToken): Promise<IWireFileDecoration | undefined> {
        const id = ++this.nextId;
        const { promise, resolve, reject } = Promise.withResolvers<IWireFileDecoration | undefined>();
        this.requests.set(id, { uri: uri.toString(), resolve, reject });
        // A request cancelled before its batch leaves is not sent; its promise is dropped by the service.
        token.onCancellationRequested(() => {
            this.requests.delete(id);
        });
        if (!this.scheduler.isScheduled()) this.scheduler.schedule();
        return promise;
    }

    public dispose(): void {
        this.scheduler.dispose();
    }

    private flush(): void {
        const requests = this.requests;
        this.requests = new Map();
        this.rpc
            .request("window.provideFileDecorations", {
                handle: this.handle,
                requests: [...requests].map(([id, { uri }]) => ({ id, uri })),
            })
            .then(
                (reply) => {
                    const data = parseWireFileDecorationReply(reply);
                    for (const [id, request] of requests) request.resolve(data.get(id));
                },
                (err: unknown) => {
                    for (const request of requests.values()) request.reject(err);
                },
            );
    }
}

interface IRegisteredProvider extends IDisposable {
    readonly emitter: Emitter<readonly Uri[] | undefined>;
}

/** Upstream's main-thread shape of an extension decoration. */
function decorationDataOf(data: IWireFileDecoration | undefined): IDecorationData | undefined {
    if (data === undefined) return undefined;
    return {
        bubble: data.propagate ?? false,
        ...(data.colorId !== undefined ? { color: data.colorId } : {}),
        ...(data.tooltip !== undefined ? { tooltip: data.tooltip } : {}),
        ...(data.badge !== undefined ? { letter: data.badge } : {}),
    };
}

/**
 * Upstream `MainThreadDecorations`. Providers belong to the spawn: when it dies, their registrations go, and so
 * does everything they decorated.
 */
export class FileDecorationsCustomer implements IExtensionHostCustomer {
    public constructor(private readonly decorations: IDecorationsService) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const providers = store.add(new DisposableMap<number, IRegisteredProvider>());

        store.add(
            rpc.handleNotification("window.registerFileDecorationProvider", (params) => {
                const registration = parseWireFileDecorationProvider(params);
                if (registration === null) return;
                const { handle, extensionId } = registration;
                const emitter = new Emitter<readonly Uri[] | undefined>();
                const queue = new DecorationRequestsQueue(rpc, handle);
                const serviceRegistration = this.decorations.registerDecorationsProvider({
                    label: extensionId,
                    onDidChange: emitter.event,
                    provideDecorations: async (uri, token) => decorationDataOf(await queue.enqueue(uri, token)),
                });
                providers.set(handle, {
                    emitter,
                    dispose: () => {
                        serviceRegistration.dispose();
                        queue.dispose();
                        emitter.dispose();
                    },
                });
            }),
        );
        store.add(
            rpc.handleNotification("window.unregisterFileDecorationProvider", (params) => {
                const request = parseWireFileDecorationProviderHandle(params);
                if (request !== null) providers.deleteAndDispose(request.handle);
            }),
        );
        store.add(
            rpc.handleNotification("window.fileDecorationsChanged", (params) => {
                const change = parseWireFileDecorationsChanged(params);
                if (change === null) return;
                providers.get(change.handle)?.emitter.fire(change.uris?.map((uri) => Uri.parse(uri)));
            }),
        );
        return store;
    }
}
