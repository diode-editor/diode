import * as path from "node:path";

import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import { isOverrideKey } from "../../../../../platform/configuration/common/configurationModel.ts";
import type { ConfigurationScope } from "../../../../../platform/configuration/common/configurationRegistry.ts";
import type { ConfigurationTarget } from "../../../../../platform/configuration/common/iConfigurationService.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IWireConfigurationUpdate, WireConfigurationTarget } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type { IExtensionHostConfigProvider, IWorkspaceFolderInfo } from "../extensionHost.ts";
import { parseWireConfigurationUpdate } from "../hostWireParsers.ts";

/**
 * Настройки и папки воркспейса для расширений (push-модель: `getConfiguration`
 * в субпроцессе синхронный). Подписка на смену настроек живёт один спавн;
 * семя `workspace.initialize` хост шлёт первым в последовательности handshake
 * ({@link pushInitialState}). Запись `WorkspaceConfiguration.update` —
 * запрос `configuration.update` ({@link writeConfiguration}).
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
        // Новое значение приезжает обратно обычным `configurationChanged`: сервис
        // эмитит событие на свою же запись ДО того, как промис записи резолвится,
        // поэтому уведомление уходит по каналу раньше ответа — после `await
        // update()` расширение уже видит значение в `get()`, как в эталоне.
        store.add(
            rpc.handleRequest("configuration.update", async (params): Promise<null> => {
                const request = parseWireConfigurationUpdate(params);
                if (request === null) {
                    throw new Error("configuration.update: expected { key: string, value?, target?, resource? }");
                }
                await this.writeConfiguration(request);
                return null;
            }),
        );
        store.add({
            dispose: () => {
                this.rpc = null;
            },
        });
        return store;
    }

    /**
     * `writeConfiguration` `mainThreadConfiguration` эталона и проверки
     * `ConfigurationEditing.validate`, которых нет у сервиса настроек: цель без
     * явного выбора — воркспейс (`deriveConfigurationTarget`; в однопапочном окне
     * всегда WORKSPACE), неизвестный ключ и цель-папка. Пустое окно и
     * application/machine-ключ в воркспейс отклоняет сам сервис. Отказ —
     * rejected promise расширению без тоста (`donotNotifyError` эталона).
     */
    private async writeConfiguration(request: IWireConfigurationUpdate): Promise<void> {
        const { key, value } = request;
        const target: WireConfigurationTarget = request.target ?? "workspace";
        const scopes = this.configuration.getConfigurationScopes();
        const scope = scopes.get(key);
        // Писать можно только зарегистрированный ключ; снятие и секции языков — любые.
        if (value !== undefined && !scopes.has(key) && !isOverrideKey(key)) {
            throw new Error(
                `Unable to write to ${targetLabel(target)} because ${key} is not a registered configuration.`,
            );
        }
        if (target === "workspaceFolder") {
            const folders = this.configuration.getWorkspaceFolders();
            if (folders.length === 0) {
                throw new Error(
                    `Unable to write to ${targetLabel(target)} because no workspace is opened. Please open a workspace first and try again.`,
                );
            }
            if (request.resource === undefined || !isInFolders(request.resource, folders)) {
                throw new Error("Unable to write to Folder Settings because no resource is provided.");
            }
            if (scope !== undefined && !FOLDER_SCOPES.includes(scope)) {
                throw new Error(
                    `Unable to write to Folder Settings because ${key} does not support the folder resource scope.`,
                );
            }
        }
        // Мульти-рута нет: настройки единственной папки — тот же файл, что у воркспейса.
        const serviceTarget: ConfigurationTarget = target === "user" ? "user" : "workspace";
        await this.configuration.updateValue(key, value, serviceTarget);
    }
}

/** Скоупы, которые ложатся в настройки папки (`FOLDER_SCOPES` эталона): без `window`, `application`, `machine`. */
const FOLDER_SCOPES: readonly ConfigurationScope[] = ["resource", "language-overridable", "machine-overridable"];

/** Имя цели в текстах отказов (`stringifyTarget` `ConfigurationEditing` эталона). */
function targetLabel(target: WireConfigurationTarget): string {
    switch (target) {
        case "user":
            return "User Settings";
        case "workspace":
            return "Workspace Settings";
        case "workspaceFolder":
            return "Folder Settings";
    }
}

/** Лежит ли ресурс в одной из папок воркспейса (`getWorkspaceFolder(resource)` эталона). */
function isInFolders(resource: string, folders: readonly IWorkspaceFolderInfo[]): boolean {
    const uri = Uri.parse(resource);
    return folders.some((folder) => {
        const root = Uri.parse(folder.uri);
        if (root.scheme !== uri.scheme) return false;
        const relative = path.relative(root.fsPath, uri.fsPath);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
}
