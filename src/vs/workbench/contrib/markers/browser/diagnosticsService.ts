import * as path from "node:path";

import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { isOverrideKey } from "../../../../platform/configuration/common/configurationModel.ts";
import type {
    ConfigurationRegistry,
    ConfigurationScope,
} from "../../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../../../platform/configuration/common/configurationRegistryDIToken.ts";
import { workspaceSettingsPath } from "../../../../platform/configuration/common/workspaceSettings.ts";
import {
    type IEnvironmentService,
    IEnvironmentServiceDIToken,
} from "../../../../platform/environment/common/environment.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../../../platform/markers/common/markerService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { WORKSPACE_FILE_SETTINGS_KEY } from "../../../../platform/workspace/common/workspaceFile.ts";
import {
    collectKnownSettingKeys,
    folderUnsupportedSettingMessage,
    validateSettingsJson,
    workspaceUnsupportedSettingMessage,
} from "../../preferences/common/settingsDiagnostics.ts";

const SETTINGS_OWNER = "settings";

interface ISettingsFile {
    /** `settings` for `.code-workspace`; absent — the root. */
    readonly section?: string;
    /** Why a key with this `scope` has no effect in this file; absent — all known keys apply. */
    readonly unsupported?: (scope: ConfigurationScope | undefined) => string | null;
}

const NO_WORKSPACE: Pick<IWorkspaceContextService, "getWorkspace"> = {
    getWorkspace: () => ({ id: null, folders: [] }),
};

export interface IDiagnosticsEditor {
    readonly uri: Uri;
    getText(): string;
    onDidChangeContent(listener: () => void): IDisposable;
    setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void;
}

export interface IDiagnosticsEditorSource {
    /** Open editors of ALL groups: every tab of a resource needs its markers. */
    getEditors(): readonly IDiagnosticsEditor[];
    getActiveEditor(): IDiagnosticsEditor | null;
    onActiveEditorChanged(listener: (editor: IDiagnosticsEditor | null) => void): IDisposable;
}

export const DiagnosticsEditorSourceDIToken = token<IDiagnosticsEditorSource>("DiagnosticsEditorSource");
export const DiagnosticsServiceDIToken = token<DiagnosticsService>("DiagnosticsService");

export class DiagnosticsService extends Disposable {
    public static dependencies = [
        DiagnosticsEditorSourceDIToken,
        MarkerServiceDIToken,
        IEnvironmentServiceDIToken,
        ConfigurationRegistryDIToken,
        IWorkspaceContextServiceDIToken,
    ] as const;

    private editorSource: IDiagnosticsEditorSource;
    private markerService: MarkerService;
    private knownSettingKeys: Set<string>;
    private settingScopes: ReadonlyMap<string, ConfigurationScope>;
    private settingsResource: Uri;
    private activeContentSubscription: IDisposable | null = null;

    public constructor(
        editorSource: IDiagnosticsEditorSource,
        markerService: MarkerService,
        environment: Pick<IEnvironmentService, "settingsResource">,
        configurationRegistry: ConfigurationRegistry,
        private readonly workspace: Pick<IWorkspaceContextService, "getWorkspace"> = NO_WORKSPACE,
    ) {
        super();
        this.editorSource = editorSource;
        this.markerService = markerService;
        // path.resolve strictly BEFORE Uri.file: Uri.file does not resolve a relative path.
        this.settingsResource = Uri.file(path.resolve(environment.settingsResource));
        // Known keys are the core plus `contributes.configuration` of all extensions
        // (an extension key may have no default — then it is not in the tree).
        this.knownSettingKeys = collectKnownSettingKeys(configurationRegistry.getDefaultConfiguration());
        for (const key of configurationRegistry.getExtensionConfigurationProperties().keys()) {
            this.knownSettingKeys.add(key);
        }
        this.settingScopes = configurationRegistry.getConfigurationScopes();

        this.register(
            this.editorSource.onActiveEditorChanged((editor) => {
                this.bindActiveEditor(editor);
                this.validate(editor);
            }),
        );
        this.register(
            this.markerService.onDidChangeMarkers((resources) => {
                this.pushDecorations(resources);
            }),
        );
        this.register({ dispose: () => this.activeContentSubscription?.dispose() });

        const active = this.editorSource.getActiveEditor();
        this.bindActiveEditor(active);
        this.validate(active);
    }

    private bindActiveEditor(editor: IDiagnosticsEditor | null): void {
        this.activeContentSubscription?.dispose();
        this.activeContentSubscription =
            editor?.onDidChangeContent(() => {
                this.validate(editor);
            }) ?? null;
    }

    private validate(editor: IDiagnosticsEditor | null): void {
        if (editor === null) return;
        // Compare the whole resource, not the basename: a foreign settings.json (VS Code's own,
        // a project's `.vscode/settings.json`) stays untouched.
        const resource = editor.uri.toString();
        const file = this.settingsFile(resource);
        if (file === null) return;

        const { unsupported } = file;
        // Language sections (`"[python]": { … }`) are also known top-level keys.
        const markers = validateSettingsJson(
            editor.getText(),
            (key) => this.knownSettingKeys.has(key) || isOverrideKey(key),
            unsupported === undefined ? undefined : (key) => unsupported(this.settingScopes.get(key)),
            file.section,
        );
        this.markerService.changeOne(SETTINGS_OWNER, resource, markers);
    }

    /** `null` — not our file; for a window folder from `.code-workspace`, `window` has no effect either. */
    private settingsFile(resource: string): ISettingsFile | null {
        if (resource === this.settingsResource.toString()) return {};
        const workspace = this.workspace.getWorkspace();
        if (workspace.configuration?.toString() === resource) {
            return { section: WORKSPACE_FILE_SETTINGS_KEY, unsupported: workspaceUnsupportedSettingMessage };
        }
        const isFolderSettings = workspace.folders.some(
            (folder) => Uri.file(workspaceSettingsPath(folder.uri.fsPath)).toString() === resource,
        );
        if (!isFolderSettings) return null;
        return {
            unsupported:
                workspace.configuration === undefined
                    ? workspaceUnsupportedSettingMessage
                    : folderUnsupportedSettingMessage,
        };
    }

    private pushDecorations(resources: readonly string[]): void {
        for (const resource of resources) {
            const decorations: IMarkerDecoration[] = this.markerService
                .read({ resource })
                .map((marker) => ({ range: marker.range, severity: marker.severity }));
            for (const editor of this.editorsForResource(resource)) {
                editor.setMarkerDecorations(decorations);
            }
        }
    }

    private editorsForResource(resource: string): IDiagnosticsEditor[] {
        return this.editorSource.getEditors().filter((editor) => editor.uri.toString() === resource);
    }
}
