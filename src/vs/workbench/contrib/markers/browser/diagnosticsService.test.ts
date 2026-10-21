import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";

import { DiagnosticsService, type IDiagnosticsEditor, type IDiagnosticsEditorSource } from "./diagnosticsService.ts";

function appConfigurationRegistry(): ConfigurationRegistry {
    return new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
}

const UNKNOWN_SETTINGS = ["{", '    "editor.tabSize": 2,', '    "editor.fontSize": 12', "}"].join("\n");
const KNOWN_SETTINGS = ["{", '    "editor.tabSize": 2', "}"].join("\n");

const SETTINGS_PATH = "/ws/settings.json";

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

class FakeEditorSource implements IDiagnosticsEditorSource {
    private editors: FakeEditor[] = [];
    private active: FakeEditor | null = null;
    private listeners = new Set<(editor: IDiagnosticsEditor | null) => void>();

    public getEditors(): readonly IDiagnosticsEditor[] {
        return this.editors;
    }

    public getActiveEditor(): IDiagnosticsEditor | null {
        return this.active;
    }

    public onActiveEditorChanged(listener: (editor: IDiagnosticsEditor | null) => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

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

function createHarness(settingsResource: string = SETTINGS_PATH): Harness {
    const source = new FakeEditorSource();
    const markerService = new MarkerService();
    const service = new DiagnosticsService(source, markerService, { settingsResource }, appConfigurationRegistry());
    return { source, markerService, service };
}

/** The marker key is the resource (`uri.toString()`), not the disk path. */
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

    it("секция языка — известный ключ верхнего уровня", () => {
        const h = createHarness();
        const text = ["{", '    "[python]": { "editor.tabSize": 2 },', '    "[nope": 1', "}"].join("\n");
        h.source.open(new FakeEditor(SETTINGS_PATH, text));

        expect(h.markerService.read().map((m) => m.message)).toEqual(["Unknown Configuration Setting: [nope"]);

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

    it("ключи расширений — известные, в том числе без дефолта; чужие — нет", () => {
        const registry = appConfigurationRegistry();
        registry.registerExtensionConfiguration("acme.ruff", {
            "ruff.importStrategy": { default: "fromEnvironment" },
            "ruff.path": {},
        });
        const source = new FakeEditorSource();
        const markerService = new MarkerService();
        const service = new DiagnosticsService(source, markerService, { settingsResource: SETTINGS_PATH }, registry);
        const text = [
            "{",
            '    "ruff.importStrategy": "useBundled",',
            '    "ruff.path": [],',
            '    "ruff.nope": 1',
            "}",
        ].join("\n");

        source.open(new FakeEditor(SETTINGS_PATH, text));

        expect(markerService.read().map((m) => m.message)).toEqual(["Unknown Configuration Setting: ruff.nope"]);
        service.dispose();
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

        expect(() => {
            h.markerService.changeOne("other", "/ws/closed.json", [
                { severity: MarkerSeverity.Error, range: createRange(0, 0, 0, 1), message: "x" },
            ]);
        }).not.toThrow();
        expect(editor.decorations).toHaveLength(1);

        h.service.dispose();
    });

    it("picks up an editor that became active before the service existed", () => {
        // The editor is active before the service is created — validation must still run.
        const source = new FakeEditorSource();
        const markerService = new MarkerService();
        const editor = new FakeEditor(SETTINGS_PATH, UNKNOWN_SETTINGS);
        source.open(editor);

        const service = new DiagnosticsService(
            source,
            markerService,
            { settingsResource: SETTINGS_PATH },
            appConfigurationRegistry(),
        );

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

        editor.setText(KNOWN_SETTINGS);
        expect(h.markerService.read({ resource: resourceOf(SETTINGS_PATH) })).toHaveLength(1);
    });
});

describe("DiagnosticsService — settings.json воркспейса", () => {
    const FOLDER = "/ws/project";
    const WORKSPACE_SETTINGS = "/ws/project/.diode/settings.json";

    function createWorkspaceHarness(folders: readonly string[] = [FOLDER], workspaceFile?: string): Harness {
        const source = new FakeEditorSource();
        const markerService = new MarkerService();
        const service = new DiagnosticsService(
            source,
            markerService,
            { settingsResource: SETTINGS_PATH },
            appConfigurationRegistry(),
            {
                getWorkspace: () => ({
                    id: null,
                    folders: folders.map((folder, index) => ({ uri: Uri.file(folder), name: "project", index })),
                    ...(workspaceFile !== undefined ? { configuration: Uri.file(workspaceFile) } : {}),
                }),
            },
        );
        return { source, markerService, service };
    }

    it("файл воркспейса валидируется: неизвестный ключ — предупреждение, machine-ключ — подсказка эталона", () => {
        const h = createWorkspaceHarness();
        const text = ["{", '    "editor.tabSize": 2,', '    "terminal.tier": "kitty",', '    "nope.key": 1', "}"].join(
            "\n",
        );
        h.source.open(new FakeEditor(WORKSPACE_SETTINGS, text));

        const markers = h.markerService.read({ resource: resourceOf(WORKSPACE_SETTINGS) });
        expect(markers.map((m) => [m.severity, m.message])).toEqual([
            [
                MarkerSeverity.Hint,
                "This setting can only be applied in user settings in local window or in remote settings in remote window.",
            ],
            [MarkerSeverity.Warning, "Unknown Configuration Setting: nope.key"],
        ]);
        h.service.dispose();
    });

    it("в user settings.json тот же machine-ключ подсказки не получает", () => {
        const h = createWorkspaceHarness();
        h.source.open(new FakeEditor(SETTINGS_PATH, `{ "terminal.tier": "kitty" }`));

        expect(h.markerService.read({ resource: resourceOf(SETTINGS_PATH) })).toEqual([]);
        h.service.dispose();
    });

    it("settings.json чужой папки и .vscode/settings.json не валидируются; без папки — тоже", () => {
        const h = createWorkspaceHarness();
        h.source.open(new FakeEditor("/ws/other/.diode/settings.json", `{ "nope.key": 1 }`));
        h.source.open(new FakeEditor("/ws/project/.vscode/settings.json", `{ "nope.key": 1 }`));
        expect(h.markerService.read()).toEqual([]);
        h.service.dispose();

        const empty = createWorkspaceHarness([]);
        empty.source.open(new FakeEditor(WORKSPACE_SETTINGS, `{ "nope.key": 1 }`));
        expect(empty.markerService.read()).toEqual([]);
        empty.service.dispose();
    });

    it("в папке окна из папки window-ключ действует — подсказки нет", () => {
        const h = createWorkspaceHarness();
        h.source.open(new FakeEditor(WORKSPACE_SETTINGS, `{ "workbench.colorTheme": "Light" }`));
        expect(h.markerService.read()).toEqual([]);
        h.service.dispose();
    });

    describe("окно из .code-workspace", () => {
        const WORKSPACE_FILE = "/ws/project/web.code-workspace";

        // Workspace file keys live in the `settings` block, not at the root: `folders`
        // is not a setting, but an unknown key inside `settings` is.
        it("файл воркспейса: проверяется блок settings — неизвестный и machine-ключ", () => {
            const h = createWorkspaceHarness([FOLDER], WORKSPACE_FILE);
            const text = JSON.stringify(
                {
                    folders: [{ path: "." }],
                    settings: { "editor.tabSize": 2, "terminal.tier": "kitty", "nope.key": 1 },
                },
                null,
                4,
            );
            h.source.open(new FakeEditor(WORKSPACE_FILE, text));

            const markers = h.markerService.read({ resource: resourceOf(WORKSPACE_FILE) });
            expect(markers.map((m) => [m.severity, m.message])).toEqual([
                [
                    MarkerSeverity.Hint,
                    "This setting can only be applied in user settings in local window or in remote settings in remote window.",
                ],
                [MarkerSeverity.Warning, "Unknown Configuration Setting: nope.key"],
            ]);
            h.service.dispose();
        });

        it("файл воркспейса без блока settings — маркеров нет", () => {
            const h = createWorkspaceHarness([FOLDER], WORKSPACE_FILE);
            h.source.open(new FakeEditor(WORKSPACE_FILE, `{ "folders": [{ "path": "." }] }`));
            expect(h.markerService.read()).toEqual([]);
            h.service.dispose();
        });

        it("чужой .code-workspace не проверяется", () => {
            const h = createWorkspaceHarness([FOLDER], WORKSPACE_FILE);
            h.source.open(new FakeEditor("/ws/project/backend.code-workspace", `{ "settings": { "nope.key": 1 } }`));
            expect(h.markerService.read()).toEqual([]);
            h.service.dispose();
        });

        // A `window` key is taken from the workspace file: in a folder it has no effect —
        // hint with upstream's text (`unsupportedWindowSetting`).
        it(".diode/settings.json папки: window-ключ — подсказка эталона, resource-ключ — нет", () => {
            const h = createWorkspaceHarness([FOLDER], WORKSPACE_FILE);
            const text = ["{", '    "workbench.colorTheme": "Light",', '    "editor.tabSize": 2', "}"].join("\n");
            h.source.open(new FakeEditor(WORKSPACE_SETTINGS, text));

            const markers = h.markerService.read({ resource: resourceOf(WORKSPACE_SETTINGS) });
            expect(markers.map((m) => [m.severity, m.message])).toEqual([
                [
                    MarkerSeverity.Hint,
                    "This setting cannot be applied in this workspace. It will be applied when you open the containing workspace folder directly.",
                ],
            ]);
            h.service.dispose();
        });

        it(".diode/settings.json папки только с ключами папки и machine-ключом — подсказка лишь на machine", () => {
            const h = createWorkspaceHarness([FOLDER], WORKSPACE_FILE);
            h.source.open(
                new FakeEditor(
                    WORKSPACE_SETTINGS,
                    `{ "editor.tabSize": 2, "files.exclude": {}, "terminal.tier": "kitty" }`,
                ),
            );

            const markers = h.markerService.read({ resource: resourceOf(WORKSPACE_SETTINGS) });
            expect(markers.map((m) => m.message)).toEqual([
                "This setting can only be applied in user settings in local window or in remote settings in remote window.",
            ]);
            h.service.dispose();
        });
    });
});
