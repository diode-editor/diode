import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it, vi } from "vitest";

import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

function createEditorService(): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

class FakePane implements IEditorPane {
    public readonly view = new TUIElement();
    public isModified = false;
    public readonly readOnly = false;
    public disposed = false;
    private readonly listeners: (() => void)[] = [];

    public readonly label: string;

    public constructor(public readonly uri: Uri) {
        this.view.id = `fake-${uri.path}`;
        this.label = uri.path;
    }

    public onDidChangeState(cb: () => void): { dispose: () => void } {
        this.listeners.push(cb);
        return {
            dispose: () => {
                const idx = this.listeners.indexOf(cb);
                if (idx >= 0) this.listeners.splice(idx, 1);
            },
        };
    }

    public markModified(): void {
        this.isModified = true;
        for (const cb of [...this.listeners]) cb();
    }

    public focusEditor(): void {
        // Focusing the fake pane leads nowhere; what matters is that the group calls it.
    }

    public getSelectedTexts(): string[] {
        return []; // the pane has no notion of selection
    }

    public dispose(): void {
        this.disposed = true;
    }
}

const fakeUri = (name: string) => Uri.from({ scheme: "fake", path: `/${name}` });

describe("EditorService — non-text panes", () => {
    it("an opened pane becomes a tab and active", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));

        service.openPane(pane);

        expect(service.editorGroups.activeGroup.editorCount).toBe(1);
        expect(service.getActivePane()).toBe(pane);
        expect(service.editorGroups.activeGroup.getPanes()).toEqual([pane]);
        expect(service.displayName(pane)).toBe("/diff");
    });

    it("the group gets the pane's view and a redraw event", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));
        const changed = vi.fn();
        service.onDidChangeEditors(changed);

        service.openPane(pane);
        expect(service.getActivePane()?.view).toBe(pane.view);

        const afterOpen = changed.mock.calls.length;
        pane.markModified();

        expect(changed.mock.calls.length).toBe(afterOpen + 1);
    });

    it("reopening the same resource switches to it instead of creating a second tab", () => {
        const service = createEditorService();
        service.openPane(new FakePane(fakeUri("diff")));
        service.openPane(new FakePane(fakeUri("other")));

        const duplicate = new FakePane(fakeUri("diff"));
        service.openPane(duplicate);

        expect(service.editorGroups.activeGroup.editorCount).toBe(2);
        expect(service.editorGroups.activeGroup.activeIndex).toBe(0);
        expect(duplicate.disposed).toBe(true);
    });

    it("closing the tab disposes the pane", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));
        service.openPane(pane);

        service.editorGroups.activeGroup.closeTab(0);

        expect(service.editorGroups.activeGroup.editorCount).toBe(0);
        expect(pane.disposed).toBe(true);
        expect(service.getActivePane()).toBeNull();
    });

    it("group focus reaches the pane", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));
        const focus = vi.spyOn(pane, "focusEditor");

        service.openPane(pane);
        service.focusEditor();

        expect(focus).toHaveBeenCalled();
    });
});

describe("EditorService — narrowing the text surface", () => {
    it("while a non-text pane is active, text getters return null", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));

        service.openPane(pane);

        expect(service.getActivePane()).toBe(pane);
        expect(service.getActiveEditor()).toBeNull();
        expect(service.getEditors()).toEqual([]);
    });

    it("active editor subscribers see a switch to a diff as `no editor`", () => {
        // Status bar, find, and host adapters must not get a pane without a cursor, language, and encoding.
        const service = createEditorService();
        const seen: unknown[] = [];
        service.onActiveEditorChanged((editor) => seen.push(editor));

        service.openPane(new FakePane(fakeUri("diff")));

        expect(seen).toEqual([null]);
    });

    it("text editing commands on a non-text pane are a no-op, not a crash", () => {
        const service = createEditorService();
        service.openPane(new FakePane(fakeUri("diff")));

        // This is what each of the 26 commands in editorActions.ts looks like.
        expect(() => service.getActiveEditor()?.viewState.cursorDown()).not.toThrow();
        expect(() => service.getActiveEditor()?.save()).not.toThrow();
    });
});

describe("EditorService — mixed group", () => {
    const openMixed = () => {
        const ws = createTempWorkspace({ prefix: "diode-panes-", files: { "a.ts": "alpha\n" } });
        const service = createEditorService();
        service.openFile(ws.path("a.ts"));
        const pane = new FakePane(fakeUri("diff"));
        service.openPane(pane);
        return { ws, service, pane };
    };

    it("tabs of both kinds live side by side and switch", () => {
        const { ws, service, pane } = openMixed();
        try {
            expect(service.editorGroups.activeGroup.editorCount).toBe(2);
            expect(service.getActivePane()).toBe(pane);

            service.editorGroups.activeGroup.activateTab(0);

            expect(service.getActiveEditor()?.uri.fsPath).toBe(ws.path("a.ts"));
            expect(service.editorGroups.activeGroup.getPanes()).toHaveLength(2);
        } finally {
            service.dispose();
            ws.dispose();
        }
    });

    it("MRU sees both tabs", () => {
        const { ws, service, pane } = openMixed();
        try {
            service.editorGroups.activeGroup.activateTab(0);
            service.editorGroups.activeGroup.cycleMru(1);

            expect(service.getActivePane()).toBe(pane);
            expect(service.editorGroups.activeGroup.getMruOrder()).toHaveLength(2);
        } finally {
            service.dispose();
            ws.dispose();
        }
    });

    it("session and shutdown see only text tabs", () => {
        const { ws, service } = openMixed();
        try {
            expect(service.getOpenFilePaths()).toEqual([ws.path("a.ts")]);
            expect(service.collectDirty()).toEqual([]);

            service.editorGroups.activeGroup.activateTab(0);
            service.getActiveEditor()?.viewState.type("X");

            expect(service.collectDirty().map((item) => item.name)).toEqual(["a.ts"]);
        } finally {
            service.dispose();
            ws.dispose();
        }
    });
});
