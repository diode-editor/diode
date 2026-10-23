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

/** Push model: `getConfiguration` in the subprocess is synchronous. */
export class ConfigurationCustomer implements IExtensionHostCustomer {
    private rpc: HostRpc | null = null;

    public constructor(private readonly configuration: IExtensionHostConfigProvider) {}

    /**
     * The handshake seed goes BEFORE the initial active-editor and the first activateExtension:
     * the extension already reads getConfiguration in activate().
     */
    public pushInitialState(): void {
        const workspaceFile = this.configuration.getWorkspaceFile();
        this.rpc?.notify("workspace.initialize", {
            configuration: this.configuration.getSnapshot(),
            workspaceFolders: this.configuration.getWorkspaceFolders(),
            // A folder window has no such field: the structured-clone wire would carry an `undefined` one.
            ...(workspaceFile !== undefined ? { workspaceFile } : {}),
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
        // The service fires the event for its own write BEFORE the write promise resolves: after `await update()`
        // the extension already sees the value in `get()`, as upstream.
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
     * Upstream `mainThreadConfiguration` `writeConfiguration` plus the `ConfigurationEditing.validate` checks
     * the settings service lacks. A refusal is a rejected promise without a toast (upstream `donotNotifyError`).
     */
    private async writeConfiguration(request: IWireConfigurationUpdate): Promise<void> {
        const { key, value } = request;
        const scopes = this.configuration.getConfigurationScopes();
        const scope = scopes.get(key);
        const target: WireConfigurationTarget =
            request.target ?? this.deriveConfigurationTarget(scope, request.resource);
        // Only a registered key can be written; removal and language sections are allowed for any key.
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
            // Stryker disable next-line ConditionalExpression: without the `undefined` check parsing an empty resource doesn't land in any folder either — the branch is for the type
            if (request.resource === undefined || !isInFolders(request.resource, folders)) {
                throw new Error("Unable to write to Folder Settings because no resource is provided.");
            }
        }
        // A single folder, no resource to choose: the service itself knows where
        // the folder settings are (for a folder window it's the same file as the workspace's).
        await this.configuration.updateValue(key, value, target);
    }

    /** Upstream `mainThreadConfiguration` `deriveConfigurationTarget`. */
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

/** Upstream `ConfigurationEditing` `stringifyTarget`. */
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

/** Upstream `getWorkspaceFolder(resource)`. */
function isInFolders(resource: string, folders: readonly IWorkspaceFolderInfo[]): boolean {
    const uri = Uri.parse(resource);
    return folders.some((folder) => {
        const root = Uri.parse(folder.uri);
        if (root.scheme !== uri.scheme) return false;
        // The folder itself yields `""` — also “inside”.
        const relative = path.relative(root.fsPath, uri.fsPath);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
    });
}
