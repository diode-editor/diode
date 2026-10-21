import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

const PREVIEW_KEY = "workbench.editor.enablePreview";

/** The registry provides the `enablePreview` default: with `NULL_CONFIGURATION_SERVICE` preview would be off. */
function defaultsConfig(): IConfigurationService {
    return createTestConfigurationService();
}

function switchableConfig(initial: boolean): {
    service: IConfigurationService;
    set: (value: boolean) => void;
} {
    let enabled = initial;
    const listeners: ((event: IConfigurationChangeEvent) => void)[] = [];
    return {
        service: {
            ...NULL_CONFIGURATION_SERVICE,
            get<T>(key: string, defaultValue?: T): T | undefined {
                return key === PREVIEW_KEY ? (enabled as unknown as T) : defaultValue;
            },
            onDidChangeConfiguration(listener) {
                listeners.push(listener);
                return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
            },
        },
        set(value: boolean) {
            enabled = value;
            const event: IConfigurationChangeEvent = {
                affectedKeys: [PREVIEW_KEY],
                overrideIdentifiers: [],
                affectsConfiguration: (key) => key === PREVIEW_KEY,
            };
            for (const listener of [...listeners]) listener(event);
        },
    };
}

/** Gets dirty silently: doesn't fire `onDidChangeState`, so the "first edit pins" latch doesn't trip. */
function makeSilentPane(uriPath: string): IEditorPane & { isModified: boolean } {
    return {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as never,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: () => ({ dispose() {} }),
        focusEditor() {},
        dispose() {},
    };
}

function createEditorService(configurationService: IConfigurationService = defaultsConfig()): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        configurationService,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

describe("EditorService — tab preview mode", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-preview-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content = name): string {
        const filePath = path.join(ws.dir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function tabs(service: EditorService): string[] {
        return service.editorGroups.activeGroup.getPanes().map((pane) => pane.label);
    }

    it("preview replaces preview: walking the tree does not pile up the tab bar", () => {
        const service = createEditorService();

        service.openFile(writeFile("a.ts"), { preview: true });
        expect(tabs(service)).toEqual(["a.ts"]);

        service.openFile(writeFile("b.ts"), { preview: true });
        expect(tabs(service)).toEqual(["b.ts"]);

        service.openFile(writeFile("c.ts"), { preview: true });
        expect(tabs(service)).toEqual(["c.ts"]);
        expect(service.editorGroups.activeGroup.previewPane?.label).toBe("c.ts");
        expect(service.editorGroups.activeGroup.activeIndex).toBe(0);
    });

    it("a preview takes the previous one's SLOT instead of moving to the end of the strip", () => {
        const service = createEditorService();
        service.openFile(writeFile("pinned.ts"));
        service.openFile(writeFile("a.ts"), { preview: true });
        service.openFile(writeFile("tail.ts"));
        expect(tabs(service)).toEqual(["pinned.ts", "a.ts", "tail.ts"]);

        service.openFile(writeFile("b.ts"), { preview: true });

        expect(tabs(service)).toEqual(["pinned.ts", "b.ts", "tail.ts"]);
        expect(service.editorGroups.activeGroup.activeIndex).toBe(1);
    });

    it("opening WITHOUT preview accumulates tabs as before", () => {
        const service = createEditorService();

        service.openFile(writeFile("a.ts"));
        service.openFile(writeFile("b.ts"));

        expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        expect(service.editorGroups.activeGroup.previewPane).toBe(null);
    });

    it("a permanent open of a preview tab pins it", () => {
        const service = createEditorService();
        const a = writeFile("a.ts");
        service.openFile(a, { preview: true });
        expect(service.editorGroups.activeGroup.previewPane?.label).toBe("a.ts");

        // Ctrl+P on a file lingering as a preview.
        service.openFile(a);

        expect(service.editorGroups.activeGroup.previewPane).toBe(null);
        expect(tabs(service)).toEqual(["a.ts"]);

        service.openFile(writeFile("b.ts"), { preview: true });
        expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
    });

    it("previewing the same file again does not clear the preview", () => {
        const service = createEditorService();
        const a = writeFile("a.ts");
        service.openFile(a, { preview: true });

        service.openFile(a, { preview: true });

        expect(service.editorGroups.activeGroup.previewPane?.label).toBe("a.ts");
    });

    it("an edit pins the preview tab, and the next preview does not lose it", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts", "const x = 1;"), { preview: true });
        const editor = service.getActiveEditor()!;

        editor.model.document.applyEdits([createInsertEdit(0, 0, "// ")]);
        expect(editor.isModified).toBe(true);

        service.openFile(writeFile("b.ts"), { preview: true });

        expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        expect(service.editorGroups.activeGroup.previewPane?.label).toBe("b.ts");
    });

    it("replacing pins a dirty tab even if the latch missed it", () => {
        // Second line of defense: the latch isn't armed, and only the `isModified` check
        // in the replacement itself stands between the edits and the replacement.
        const service = createEditorService();
        const group = service.editorGroups.activeGroup;
        const silent = makeSilentPane("/silent.ts");
        group.insertPane(silent, { preview: true });
        group.activateTab(0);
        silent.isModified = true;

        service.openFile(writeFile("b.ts"), { preview: true });

        expect(tabs(service)).toEqual(["/silent.ts", "b.ts"]);
        expect(group.isPinned(silent)).toBe(true);
        expect(group.previewPane?.label).toBe("b.ts");
    });

    it("shared dirty model: a tab arriving dirty does not become preview, the previous one is pinned", () => {
        // The model is shared through the registry, so the new tab is born dirty. The previous (also dirty)
        // preview must be pinned, otherwise the next preview would take its edits away.
        const service = createEditorService();
        const shared = writeFile("shared.ts");
        service.openFile(shared);
        const opened = service.getActiveEditor();
        if (opened === null) throw new Error("tab did not open");
        opened.pushUndo(opened.viewState.type("dirty"));

        const second = service.editorGroups.newGroup("after");
        if (second === null) throw new Error("second group was not created");
        const silent = makeSilentPane("/silent.ts");
        second.insertPane(silent, { preview: true });
        second.activateTab(0);
        silent.isModified = true;

        service.openFile(shared, { group: second, preview: true });

        expect(second.getPanes().map((pane) => pane.label)).toEqual(["/silent.ts", "shared.ts"]);
        expect(second.previewPane).toBe(null);
        expect(second.isPinned(silent)).toBe(true);
    });

    it("split pins the source tab", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"), { preview: true });
        const source = service.editorGroups.activeGroup;

        service.splitActiveGroup();

        expect(source.previewPane).toBe(null);
        expect(service.editorGroups.activeGroup.previewPane).toBe(null);
    });

    it("copying a tab to the neighbouring group pins the source", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"), { preview: true });
        const source = service.editorGroups.activeGroup;
        service.editorGroups.newGroup("after");
        service.editorGroups.focusGroup(source.id);

        service.copyActiveEditorToGroup("next");

        expect(source.previewPane).toBe(null);
        expect(service.editorGroups.activeGroup.previewPane).toBe(null);
    });

    it("moving a tab to the neighbouring group pins it", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"), { preview: true });
        const source = service.editorGroups.activeGroup;

        service.editorGroups.moveActiveEditorToGroup("next");

        expect(service.editorGroups.activeGroup === source).toBe(false);
        expect(service.editorGroups.activeGroup.previewPane).toBe(null);
    });

    it("`group: beside` previews in the neighbouring group, not the active one", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"));
        const source = service.editorGroups.activeGroup;

        service.openFile(writeFile("b.ts"), { group: "beside", preview: true });

        expect(source.previewPane).toBe(null);
        expect(service.editorGroups.activeGroup === source).toBe(false);
        expect(service.editorGroups.activeGroup.previewPane?.label).toBe("b.ts");
    });

    describe("setting workbench.editor.enablePreview", () => {
        it("disabled: no preview is created, tabs accumulate", () => {
            const service = createEditorService(switchableConfig(false).service);

            service.openFile(writeFile("a.ts"), { preview: true });
            service.openFile(writeFile("b.ts"), { preview: true });

            expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
            expect(service.editorGroups.activeGroup.previewPane).toBe(null);
        });

        it("disabling at runtime pins the already open preview", () => {
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });
            expect(service.editorGroups.activeGroup.previewPane?.label).toBe("a.ts");

            config.set(false);

            expect(service.editorGroups.activeGroup.previewPane).toBe(null);
            service.openFile(writeFile("b.ts"), { preview: true });
            expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        });

        it("a preview key event with the setting ENABLED does not clear the preview", () => {
            // Re-saving settings.json fires an event for the key even when
            // the value is the same: only TURNING OFF may pin previews.
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });

            config.set(true);

            expect(service.editorGroups.activeGroup.previewPane?.label).toBe("a.ts");
            service.openFile(writeFile("b.ts"), { preview: true });
            expect(tabs(service)).toEqual(["b.ts"]);
        });

        it("enabling at runtime leaves open tabs alone", () => {
            const config = switchableConfig(false);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });

            config.set(true);

            expect(service.editorGroups.activeGroup.previewPane).toBe(null);
            service.openFile(writeFile("b.ts"), { preview: true });
            expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        });

        it("disabling does not wake groups that had no preview", () => {
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });
            const withPreview = service.editorGroups.activeGroup;
            const second = service.editorGroups.newGroup("after");
            if (second === null) throw new Error("second group was not created");
            service.openFile(writeFile("b.ts"), { group: second });
            let quietGroupEvents = 0;
            second.onDidChangeEditors(() => quietGroupEvents++);

            config.set(false);

            // An extra event means an extra strip repaint for the untouched half of the split.
            expect(quietGroupEvents).toBe(0);
            expect(withPreview.previewPane).toBe(null);
        });

        it("disabling pins the preview in ALL groups of the strip", () => {
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });
            const first = service.editorGroups.activeGroup;
            service.openFile(writeFile("b.ts"), { group: "beside", preview: true });
            const second = service.editorGroups.activeGroup;
            expect(first.previewPane?.label).toBe("a.ts");
            expect(second.previewPane?.label).toBe("b.ts");

            config.set(false);

            expect(first.previewPane).toBe(null);
            expect(second.previewPane).toBe(null);
        });
    });
});
