import * as path from "node:path";

import { Disposable, type IDisposable } from "@tuidom/all/common/disposable";
import { Uri } from "../../../../base/common/uri.ts";
import type { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../../../platform/configuration/common/configurationRegistryDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken, SettingsResourceDIToken } from "../../../common/coreTokens.ts";
import { collectKnownSettingKeys, validateSettingsJson } from "../../preferences/common/settingsDiagnostics.ts";

/** Marker owner used by the built-in settings.json validator. */
const SETTINGS_OWNER = "settings";

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
    readonly editorCount: number;
    getEditor(index: number): IDiagnosticsEditor | null;
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
        SettingsResourceDIToken,
        ConfigurationRegistryDIToken,
    ] as const;

    private editorSource: IDiagnosticsEditorSource;
    private markerService: MarkerService;
    private knownSettingKeys: Set<string>;
    /**
     * Ресурс настроек, который валидируем, или `null`, если он неизвестен.
     *
     * Шов между инфраструктурой и документами: `UserDataPaths` отдаёт settings.json
     * строкой-путём (он там честный путь на диске), а поднимает его в ресурс тот, кто
     * открывает файл как документ, — то есть мы, один раз в конструкторе.
     */
    private settingsResource: Uri | null;
    private activeContentSubscription: IDisposable | null = null;

    public constructor(
        editorSource: IDiagnosticsEditorSource,
        markerService: MarkerService,
        settingsResource: string | null,
        configurationRegistry: ConfigurationRegistry,
    ) {
        super();
        this.editorSource = editorSource;
        this.markerService = markerService;
        // path.resolve строго ДО Uri.file: Uri.file относительный путь не резолвит.
        this.settingsResource = settingsResource === null ? null : Uri.file(path.resolve(settingsResource));
        this.knownSettingKeys = collectKnownSettingKeys(configurationRegistry.getDefaultConfiguration());

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
        // Валидируем только settings.json активного профиля — сверяем ресурс целиком,
        // а не basename, чтобы чужой settings.json (например, самого VS Code или
        // workspace-ный .vscode/settings.json) остался нетронутым.
        if (this.settingsResource === null) return;
        const resource = editor.uri;
        if (resource.toString() !== this.settingsResource.toString()) return;

        const markers = validateSettingsJson(editor.getText(), (key) => this.knownSettingKeys.has(key));
        this.markerService.changeOne(SETTINGS_OWNER, resource.toString(), markers);
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
        const result: IDiagnosticsEditor[] = [];
        for (let i = 0; i < this.editorSource.editorCount; i++) {
            const editor = this.editorSource.getEditor(i);
            /* v8 ignore start -- defensive: i is bounded by editorCount, so getEditor always returns an open editor */
            if (editor === null) continue;
            /* v8 ignore stop */
            if (editor.uri.toString() === resource) result.push(editor);
        }
        return result;
    }
}
