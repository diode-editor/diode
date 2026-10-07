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
import {
    collectKnownSettingKeys,
    validateSettingsJson,
    workspaceUnsupportedSettingMessage,
} from "../../preferences/common/settingsDiagnostics.ts";

/** Marker owner used by the built-in settings.json validator. */
const SETTINGS_OWNER = "settings";

/** Окно без папок — для юнитов, которым файл воркспейса не нужен. */
const NO_WORKSPACE: Pick<IWorkspaceContextService, "getWorkspace"> = {
    getWorkspace: () => ({ id: null, folders: [] }),
};

/**
 * Минимальный срез открытого редактора, нужный диагностикам: ресурс, текст,
 * событие изменения контента и канал squiggle-декораций. Пара `TextFileModel` +
 * `TextEditorPane` (`TextFileModel` + `EditorComponent`) соответствует ему структурно,
 * связывание делает DI-модуль ({@link DiagnosticsEditorSourceDIToken}).
 */
export interface IDiagnosticsEditor {
    readonly uri: Uri;
    getText(): string;
    onDidChangeContent(listener: () => void): IDisposable;
    setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void;
}

/** Поставщик открытых редакторов для {@link DiagnosticsService}. */
export interface IDiagnosticsEditorSource {
    /** Открытые редакторы ВСЕХ групп: маркеры ресурса нужны каждой его вкладке. */
    getEditors(): readonly IDiagnosticsEditor[];
    getActiveEditor(): IDiagnosticsEditor | null;
    onActiveEditorChanged(listener: (editor: IDiagnosticsEditor | null) => void): IDisposable;
}

export const DiagnosticsEditorSourceDIToken = token<IDiagnosticsEditorSource>("DiagnosticsEditorSource");
export const DiagnosticsServiceDIToken = token<DiagnosticsService>("DiagnosticsService");

/**
 * Wires the built-in diagnostic providers into the {@link MarkerService} and
 * pushes the resulting markers back to open editors as squiggle decorations.
 *
 * MVP: a single provider — the settings.json validator — and a single consumer
 * — editor squiggles. The problems panel is just another consumer of the same
 * service. No language server or problem matcher involved.
 *
 * Headless-сервис: все подписки живут с конструктора; там же подхватывается
 * редактор, ставший активным до создания сервиса (как у contribution'ов
 * статус-бара).
 */
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
    /** `scope` ключей ядра и расширений — какие ключи не действуют в settings.json воркспейса. */
    private settingScopes: ReadonlyMap<string, ConfigurationScope>;
    /**
     * Ресурс настроек, который валидируем.
     *
     * Шов между инфраструктурой и документами: окружение отдаёт settings.json
     * строкой-путём (он там честный путь на диске), а поднимает его в ресурс тот, кто
     * открывает файл как документ, — то есть мы, один раз в конструкторе.
     */
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
        // path.resolve строго ДО Uri.file: Uri.file относительный путь не резолвит.
        this.settingsResource = Uri.file(path.resolve(environment.settingsResource));
        // Известные ключи — ядро и `contributes.configuration` всех расширений
        // (у ключа расширения дефолта может не быть — тогда в дереве его нет).
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

        // Pick up an editor that became active before this subscription existed.
        const active = this.editorSource.getActiveEditor();
        this.bindActiveEditor(active);
        this.validate(active);
    }

    /** Re-validates the active editor whenever its content changes. */
    private bindActiveEditor(editor: IDiagnosticsEditor | null): void {
        this.activeContentSubscription?.dispose();
        this.activeContentSubscription =
            editor?.onDidChangeContent(() => {
                this.validate(editor);
            }) ?? null;
    }

    /**
     * Runs the applicable providers for `editor` and publishes their markers.
     * Currently only the settings.json validator; no-op for other files.
     */
    private validate(editor: IDiagnosticsEditor | null): void {
        if (editor === null) return;
        // Валидируем только settings.json активного профиля и `.diode/settings.json`
        // открытой папки — сверяем ресурс целиком, а не basename, чтобы чужой
        // settings.json (например, самого VS Code или `.vscode/settings.json`
        // проекта) остался нетронутым.
        const resource = editor.uri.toString();
        const isUserSettings = resource === this.settingsResource.toString();
        if (!isUserSettings && !this.isWorkspaceSettings(resource)) return;

        // Секции языков (`"[python]": { … }`) — тоже известные ключи верхнего уровня.
        const markers = validateSettingsJson(
            editor.getText(),
            (key) => this.knownSettingKeys.has(key) || isOverrideKey(key),
            // В файле воркспейса ключи `application`/`machine` не действуют —
            // подсказка с объяснением, как у эталона.
            isUserSettings ? undefined : (key) => workspaceUnsupportedSettingMessage(this.settingScopes.get(key)),
        );
        this.markerService.changeOne(SETTINGS_OWNER, resource, markers);
    }

    /** `resource` — settings.json воркспейса одной из открытых папок. */
    private isWorkspaceSettings(resource: string): boolean {
        return this.workspace
            .getWorkspace()
            .folders.some((folder) => Uri.file(workspaceSettingsPath(folder.uri.fsPath)).toString() === resource);
    }

    /** Pushes the current markers for each changed resource to its open editor(s). */
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
