import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";
import type { IEditorGroupsService } from "../common/editorGroupsService.ts";

import { EditorService } from "./editorService.ts";

/** Event order is a contract (`docs/arch/workbench/EditorPart.md`): tabs → active editor → active group. */
describe("IEditorGroupsService — events at the EditorService boundary", () => {
    let ws: ITempWorkspace;
    let editors: EditorService;
    let groups: IEditorGroupsService;
    let events: string[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-groups-", files: { "a.txt": "a\n", "b.txt": "b\n" } });
        editors = new EditorService(
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
        groups = editors.editorGroups;
        events = [];
    });

    afterEach(() => {
        editors.dispose();
        ws.dispose();
    });

    function record(): void {
        groups.onDidGroupsChange((event) => events.push(`groups:${event.kind}`));
        editors.onDidChangeEditors(() => events.push("editors"));
        editors.onActiveEditorChanged((editor) => events.push(`active:${editor?.fileName ?? "none"}`));
        groups.onDidActiveGroupChange((group) => events.push(`group:${String(groups.viewColumnOf(group))}`));
    }

    it("split: group added → tab duplicate → active editor → active group", () => {
        editors.openFile(ws.path("a.txt"));
        record();

        editors.splitActiveGroup();

        expect(events.filter((event) => event !== "editors")).toEqual(["groups:added", "active:a.txt", "group:2"]);
        expect(events.indexOf("editors")).toBeLessThan(events.indexOf("active:a.txt"));
    });

    it("opening into the neighbouring group: the active group changes after the tab, once", () => {
        editors.openFile(ws.path("a.txt"));
        editors.splitActiveGroup();
        groups.focusGroup({ index: 0 });
        record();

        editors.openFile(ws.path("b.txt"), { group: groups.groups[1] });

        expect(events.filter((event) => event.startsWith("group:"))).toEqual(["group:2"]);
        expect(events.at(-1)).toBe("group:2");
        expect(events).toContain("active:b.txt");
    });

    it("opening into the already active group does not announce a group change", () => {
        record();

        editors.openFile(ws.path("a.txt"));

        expect(events.filter((event) => event.startsWith("group:"))).toEqual([]);
        expect(events).toContain("active:a.txt");
    });

    it("focusing another group: active editor → active group, tabs untouched", () => {
        editors.openFile(ws.path("a.txt"));
        editors.splitActiveGroup();
        editors.openFile(ws.path("b.txt"));
        record();

        groups.focusGroup({ index: 0 });

        expect(events).toEqual(["active:a.txt", "group:1"]);
    });

    it("split focuses the tab duplicate by default, not with focus: false", () => {
        editors.openFile(ws.path("a.txt"));

        const focusedByDefault = vi.spyOn(TextEditorPane.prototype, "focusEditor");
        editors.splitActiveGroup();
        expect(focusedByDefault).toHaveBeenCalled();
        focusedByDefault.mockRestore();

        const focusedQuietly = vi.spyOn(TextEditorPane.prototype, "focusEditor");
        editors.splitActiveGroup({ focus: false });
        expect(focusedQuietly).not.toHaveBeenCalled();
        focusedQuietly.mockRestore();
    });

    it("the `beside` side without room: the active group, the strip does not grow", () => {
        groups.canAddGroupHook = () => false;
        record();

        expect(groups.sideGroup()).toBe(groups.activeGroup);
        expect(groups.groups).toHaveLength(1);
        expect(events).toEqual([]);
    });

    it("the `beside` side is created to the right of the active one and does not become active", () => {
        record();

        const side = groups.sideGroup();

        expect(groups.groups.indexOf(side)).toBe(1);
        expect(groups.activeGroup).not.toBe(side);
        expect(events).toEqual(["groups:added"]);
        expect(groups.sideGroup()).toBe(side);
        expect(groups.groups).toHaveLength(2);
    });
});
