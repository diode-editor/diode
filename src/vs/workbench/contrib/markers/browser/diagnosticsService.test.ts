import { describe, expect, it } from "vitest";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";

import { DiagnosticsService, type IDiagnosticsEditor, type IDiagnosticsEditorSource } from "./diagnosticsService.ts";

/** Реестр с реальными узлами приложения — известные ключи как в production. */
function appConfigurationRegistry(): ConfigurationRegistry {
    return new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
}

const UNKNOWN_SETTINGS = ["{", '    "editor.tabSize": 2,', '    "editor.fontSize": 12', "}"].join("\n");
const KNOWN_SETTINGS = ["{", '    "editor.tabSize": 2', "}"].join("\n");

const SETTINGS_PATH = "/ws/settings.json";

/** Редактор-фейк: реализует срез {@link IDiagnosticsEditor} и записывает декорации. */
class FakeEditor implements IDiagnosticsEditor {
    public readonly uri: Uri;
    public decorations: readonly IMarkerDecoration[] = [];
    private text: string;
    private listeners = new Set<() => void>();

    public constructor(filePath: string, text: string) {
        this.uri = Uri.file(filePath);
        this.text = text;
    }

    public getText(): string {
        return this.text;
    }

    /** Правка контента: меняет текст и файрит onDidChangeContent (как документ). */
    public setText(text: string): void {
        this.text = text;
        for (const listener of [...this.listeners]) listener();
    }

    public onDidChangeContent(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        this.decorations = decorations;
    }
}

/** Источник редакторов-фейк: структурная замена EditorService в шве. */
class FakeEditorSource implements IDiagnosticsEditorSource {
    private editors: FakeEditor[] = [];
    private active: FakeEditor | null = null;
    private listeners = new Set<(editor: IDiagnosticsEditor | null) => void>();

    public get editorCount(): number {
        return this.editors.length;
    }

    public getEditor(index: number): IDiagnosticsEditor | null {
        return this.editors[index] ?? null;
    }

    public getActiveEditor(): IDiagnosticsEditor | null {
        return this.active;
    }

    public onActiveEditorChanged(listener: (editor: IDiagnosticsEditor | null) => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** «Открывает» редактор: добавляет в группу и делает активным. */
    public open(editor: FakeEditor): void {
        this.editors.push(editor);
        this.active = editor;
        for (const listener of [...this.listeners]) listener(editor);
    }
}

interface Harness {
    source: FakeEditorSource;
    markerService: MarkerService;
    service: DiagnosticsService;
}

function createHarness(settingsResource: string | null = SETTINGS_PATH): Harness {
    const source = new FakeEditorSource();
    const markerService = new MarkerService();
    const service = new DiagnosticsService(source, markerService, settingsResource, appConfigurationRegistry());
    return { source, markerService, service };
}

/** Ключ маркера — ресурс (`uri.toString()`), а не путь на диске. */
function resourceOf(filePath: string): string {
    return Uri.file(filePath).toString();
}

describe("DiagnosticsService — settings.json validation", () => {
    it("warns on unknown settings and pushes squiggle decorations to the editor", () => {
        const h = createHarness();
        const editor = new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS);
        h.source.open(editor);

        const markers = h.markerService.read({ resource: resourceOf(SETTINGS_PATH) });
        expect(markers).toHaveLength(1);
        expect(markers[0].severity).toBe(MarkerSeverity.Warning);
        expect(markers[0].message).toContain("editor.fontSize");

        expect(editor.decorations).toHaveLength(1);
        expect(editor.decorations[0].severity).toBe(MarkerSeverity.Warning);
        expect(editor.decorations[0].range.start.line).toBe(2);

        h.service.dispose();
    });

    it("reports no markers when every setting is known", () => {
        const h = createHarness();
        const editor = new FakeEditor(SETTINGS_PATH, KNOWN_SETTINGS);
        h.source.open(editor);

        expect(h.markerService.read({ resource: resourceOf(SETTINGS_PATH) })).toEqual([]);
        expect(editor.decorations).toEqual([]);

        h.service.dispose();
    });

    it("ignores a settings.json that is not the Diode settings file", () => {
        // A settings.json from elsewhere (e.g. VS Code's own, or a workspace one)
        // shares the basename but not the path — it must not be validated.
        const h = createHarness();
        const foreign = new FakeEditor("/other/settings.json", UNKNOWN_SETTINGS);
        h.source.open(foreign);

        expect(h.markerService.read()).toEqual([]);
        expect(foreign.decorations).toEqual([]);

        h.service.dispose();
    });

    it("does not validate anything when no settings resource is configured", () => {
        const h = createHarness(null);
        h.source.open(new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS));

        expect(h.markerService.read()).toEqual([]);

        h.service.dispose();
    });

    it("re-validates and repositions markers as the document changes", () => {
        const h = createHarness();
        const editor = new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS);
        h.source.open(editor);
        expect(h.markerService.read({ resource: resourceOf(SETTINGS_PATH) })[0].range.start.line).toBe(2);

        // Insert a blank first line; the unknown key shifts down and must be re-flagged there.
        editor.setText("\n" + UNKNOWN_SETTINGS);

        const markers = h.markerService.read({ resource: resourceOf(SETTINGS_PATH) });
        expect(markers).toHaveLength(1);
        expect(markers[0].range.start.line).toBe(3);
        expect(editor.decorations[0].range.start.line).toBe(3);

        h.service.dispose();
    });

    it("ignores marker changes for resources with no open editor", () => {
        const h = createHarness();
        const editor = new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS);
        h.source.open(editor);

        // A marker for a file that is not open must not throw and must not touch
        // the active editor's decorations.
        expect(() => {
            h.markerService.changeOne("other", "/ws/closed.json", [
                { severity: MarkerSeverity.Error, range: createRange(0, 0, 0, 1), message: "x" },
            ]);
        }).not.toThrow();
        expect(editor.decorations).toHaveLength(1);

        h.service.dispose();
    });

    it("picks up an editor that became active before the service existed", () => {
        // Подхват в конструкторе (бывший mount): редактор уже активен к моменту
        // создания сервиса — валидация всё равно должна отработать.
        const source = new FakeEditorSource();
        const markerService = new MarkerService();
        const editor = new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS);
        source.open(editor);

        const service = new DiagnosticsService(source, markerService, SETTINGS_PATH, appConfigurationRegistry());

        expect(markerService.read({ resource: resourceOf(SETTINGS_PATH) })).toHaveLength(1);
        expect(editor.decorations).toHaveLength(1);

        service.dispose();
    });

    it("stops validating after dispose", () => {
        const h = createHarness();
        const editor = new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS);
        h.source.open(editor);
        expect(editor.decorations).toHaveLength(1);

        h.service.dispose();

        // Правка после dispose: подписка на контент снята — маркеры не пересчитываются.
        editor.setText(KNOWN_SETTINGS);
        expect(h.markerService.read({ resource: resourceOf(SETTINGS_PATH) })).toHaveLength(1);
    });
});
