import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type { IExtensionHostConfigProvider } from "../extensionHost.ts";

/**
 * Настройки и папки воркспейса для расширений (push-модель: `getConfiguration`
 * в субпроцессе синхронный). Подписка на смену настроек живёт один спавн;
 * семя `workspace.initialize` хост шлёт первым в последовательности handshake
 * ({@link pushInitialState}).
 */
export class ConfigurationCustomer implements IExtensionHostCustomer {
    /** Канал текущего спавна; `null` — спавна нет. */
    private rpc: HostRpc | null = null;

    public constructor(private readonly configuration: IExtensionHostConfigProvider) {}

    /**
     * Семя handshake — ДО стартового active-editor и первого activateExtension:
     * расширение читает getConfiguration уже в activate().
     */
    public pushInitialState(): void {
        this.rpc?.notify("workspace.initialize", {
            configuration: this.configuration.getSnapshot(),
            workspaceFolders: this.configuration.getWorkspaceFolders(),
        });
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            this.configuration.onDidChange((affectedKeys) => {
                rpc.notify("workspace.configurationChanged", {
                    configuration: this.configuration.getSnapshot(),
                    affectedKeys,
                });
            }),
        );
        store.add({
            dispose: () => {
                this.rpc = null;
            },
        });
        return store;
    }
}
