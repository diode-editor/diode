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

/** Push-модель: `getConfiguration` в субпроцессе синхронный. */
export class ConfigurationCustomer implements IExtensionHostCustomer {
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
            // У окна из папки — `undefined`: провод (JSON) такое поле не везёт.
            workspaceFile: this.configuration.getWorkspaceFile(),
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
        // Сервис эмитит событие на свою запись ДО резолва промиса записи: после `await update()`
        // расширение уже видит значение в `get()`, как в эталоне.
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
     * `writeConfiguration` `mainThreadConfiguration` эталона плюс проверки `ConfigurationEditing.validate`,
     * которых нет у сервиса настроек. Отказ — rejected promise без тоста (`donotNotifyError` эталона).
     */
    private async writeConfiguration(request: IWireConfigurationUpdate): Promise<void> {
        const { key, value } = request;
        const scopes = this.configuration.getConfigurationScopes();
        const scope = scopes.get(key);
        const target: WireConfigurationTarget =
            request.target ?? this.deriveConfigurationTarget(scope, request.resource);
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
            // Stryker disable next-line ConditionalExpression: без проверки `undefined` разбор пустого ресурса тоже не попадает ни в одну папку — ветка нужна типу
            if (request.resource === undefined || !isInFolders(request.resource, folders)) {
                throw new Error("Unable to write to Folder Settings because no resource is provided.");
            }
        }
        // Папка единственная, ресурс выбирать не из чего: сервис сам знает, где
        // настройки папки (у окна из папки — тот же файл, что у воркспейса).
        await this.configuration.updateValue(key, value, target);
    }

    /** `deriveConfigurationTarget` `mainThreadConfiguration` эталона. */
    private deriveConfigurationTarget(
        scope: ConfigurationScope | undefined,
        resource: string | undefined,
    ): WireConfigurationTarget {
        if (
            resource !== undefined &&
            this.configuration.getWorkspaceFile() !== undefined &&
            (scope === "resource" || scope === "language-overridable")
        ) {
            return "workspaceFolder";
        }
        return "workspace";
    }
}

/** `stringifyTarget` `ConfigurationEditing` эталона. */
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

/** `getWorkspaceFolder(resource)` эталона. */
function isInFolders(resource: string, folders: readonly IWorkspaceFolderInfo[]): boolean {
    const uri = Uri.parse(resource);
    return folders.some((folder) => {
        const root = Uri.parse(folder.uri);
        if (root.scheme !== uri.scheme) return false;
        // Сама папка даёт `""` — тоже «внутри».
        const relative = path.relative(root.fsPath, uri.fsPath);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
}
