import { Emitter } from "../../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type { IExtensionUriHandlers } from "../../common/extensionUrlHandler.ts";
import { parseWireUriHandlerRegistration } from "../hostWireParsers.ts";

/**
 * Обработчики URI расширений на хосте (`MainThreadUrls` эталона): реестр
 * `window.registerUriHandler` субпроцесса и доставка URI запросом
 * `window.handleUri`. Решение «кому и когда» — у `ExtensionUrlHandler`.
 *
 * Реестр живёт один спавн: обработчики умершего субпроцесса уходят вместе с
 * ним, а оживлённое расширение заведёт свой заново на активации.
 */
export class UriHandlersCustomer extends Disposable implements IExtensionHostCustomer, IExtensionUriHandlers {
    /** Текущий спавн: канал и зарегистрированные id (ключ — нижний регистр); `null` — спавна нет. */
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
                // Stryker disable next-line ConditionalExpression: эквивалентный — без проверки `null` падает на `toLowerCase` до записи и события, RpcEndpoint глотает исключение нотификации; наблюдаемо то же «проигнорировано»
                if (extensionId === null) return;
                live.ids.add(extensionId.toLowerCase());
                this.onDidRegisterEmitter.fire(extensionId);
            }),
        );
        store.add(
            rpc.handleNotification("window.unregisterUriHandler", (params): void => {
                const extensionId = parseWireUriHandlerRegistration(params);
                // Stryker disable next-line ConditionalExpression: эквивалентный — `null` в нижний регистр не переводится, ранний выход только для типа
                if (extensionId === null) return;
                live.ids.delete(extensionId.toLowerCase());
            }),
        );
        // Спавн снимается до подключения следующего (`endSpawn`) — забываем его целиком.
        store.add({
            dispose: () => {
                this.live = null;
            },
        });
        return store;
    }
}
