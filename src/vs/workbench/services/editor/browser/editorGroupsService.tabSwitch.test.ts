import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import type { MruCycleState } from "./editorGroupModel.ts";
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

describe("EditorGroupsService — tab switching (Ctrl+PgUp/PgDn and Ctrl+Tab cycle events)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-tabswitch-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content = name): string {
        const filePath = path.join(ws.dir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function openThree(ctrl: EditorService): void {
        ctrl.openFile(writeFile("a.ts"));
        ctrl.openFile(writeFile("b.ts"));
        ctrl.openFile(writeFile("c.ts"));
    }

    function activeName(ctrl: EditorService): string | null | undefined {
        return ctrl.getActiveEditor()?.fileName;
    }

    describe("cycleEditor — visual order, not MRU", () => {
        it("a forward step goes to the next tab by position, wrapping around", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            const groupChanges: unknown[] = [];
            ctrl.editorGroups.onDidActiveGroupChange((group) => groupChanges.push(group));

            // c (the last) is active. An MRU step would go to b; a visual one wraps around to a.
            ctrl.editorGroups.cycleEditor(1);
            expect(activeName(ctrl)).toBe("a.ts");
            ctrl.editorGroups.cycleEditor(1);
            expect(activeName(ctrl)).toBe("b.ts");

            expect(groupChanges).toEqual([]);
        });

        it("a backward step goes to the previous tab by position, wrapping to the last", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.editorGroups.activeGroup.activateTab(0);
            ctrl.editorGroups.cycleEditor(-1);
            expect(activeName(ctrl)).toBe("c.ts");
        });

        it("each step commits to MRU immediately, without a hold session", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.editorGroups.cycleEditor(1); // → a
            expect(ctrl.editorGroups.activeGroup.getMruOrder()[0]?.label).toBe("a.ts");
        });

        it("a single tab (and an empty strip) is a no-op", () => {
            const ctrl = createEditorService();
            ctrl.editorGroups.cycleEditor(1);
            expect(ctrl.getActiveEditor()).toBeNull();

            ctrl.openFile(writeFile("solo.ts"));
            ctrl.editorGroups.cycleEditor(1);
            ctrl.editorGroups.cycleEditor(-1);
            expect(activeName(ctrl)).toBe("solo.ts");
        });

        it("two tabs: the minimal cycle already works (the `fewer than two` boundary)", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            ctrl.editorGroups.cycleEditor(1);
            expect(activeName(ctrl)).toBe("a.ts");
        });

        it("crosses the group boundary: after the group's last tab comes the next group's first", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            const split = ctrl.splitActiveGroup();
            expect(split).not.toBeNull();
            // Strip: g1 [a, b] · g2 [b]; g2:b is active (the strip's last tab).
            const groupChanges: number[] = [];
            ctrl.editorGroups.onDidActiveGroupChange((group) => groupChanges.push(group.id));

            ctrl.editorGroups.cycleEditor(1);

            expect(ctrl.editorGroups.activeGroup).toBe(ctrl.editorGroups.groups[0]);
            expect(activeName(ctrl)).toBe("a.ts");
            expect(groupChanges).toHaveLength(1);
        });

        it("a backward step from the strip's first tab goes to the last tab of the last group", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            ctrl.splitActiveGroup();
            ctrl.editorGroups.notifyGroupFocused(ctrl.editorGroups.groups[0]);
            ctrl.editorGroups.activeGroup.activateTab(0); // g1:a — the strip's first tab

            ctrl.editorGroups.cycleEditor(-1);

            expect(ctrl.editorGroups.activeGroup).toBe(ctrl.editorGroups.groups[1]);
            expect(activeName(ctrl)).toBe("b.ts");
        });

        it("with an empty active group `forward` starts at the strip's first tab, `back` at the last", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.editorGroups.newGroup("after");
            expect(ctrl.editorGroups.activeGroup.editorCount).toBe(0);

            ctrl.editorGroups.cycleEditor(1);
            expect(activeName(ctrl)).toBe("a.ts");

            // Recreate the collapsed empty group for the opposite direction.
            ctrl.editorGroups.newGroup("after");
            ctrl.editorGroups.cycleEditor(-1);
            expect(activeName(ctrl)).toBe("c.ts");
        });
    });

    describe("onDidChangeMruCycle — event for the switcher overlay", () => {
        function record(ctrl: EditorService): (MruCycleState | null)[] {
            const events: (MruCycleState | null)[] = [];
            ctrl.editorGroups.onDidChangeMruCycle((state) => events.push(state));
            return events;
        }

        it("a cycle step in the active group reaches the facade subscriber", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            const events = record(ctrl);

            ctrl.editorGroups.activeGroup.cycleMru(1);

            expect(events).toHaveLength(1);
            expect(events[0]?.pointer).toBe(1);
            expect(events[0]?.panes.map((pane) => pane.label)).toEqual(["c.ts", "b.ts", "a.ts"]);
        });

        it("the cycle end arrives as null; unsubscribing removes the listener", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            const events: (MruCycleState | null)[] = [];
            const subscription = ctrl.editorGroups.onDidChangeMruCycle((state) => events.push(state));

            ctrl.editorGroups.activeGroup.cycleMru(1);
            ctrl.editorGroups.activeGroup.endMruCycle();
            expect(events[1]).toBeNull();

            const others: (MruCycleState | null)[] = [];
            ctrl.editorGroups.onDidChangeMruCycle((state) => others.push(state));
            subscription.dispose();
            // A repeated dispose is harmless and does NOT touch other subscriptions.
            subscription.dispose();
            ctrl.editorGroups.activeGroup.cycleMru(1);
            expect(events).toHaveLength(2);
            expect(others).toHaveLength(1);
        });

        it("a cycle in a group created by a split AFTER subscribing is forwarded too", () => {
            const ctrl = createEditorService();
            ctrl.openFile(writeFile("a.ts"));
            ctrl.openFile(writeFile("b.ts"));
            const events = record(ctrl);

            ctrl.splitActiveGroup();
            // The active group is the new one (g2) with [b]; add a second tab for the cycle.
            ctrl.openFile(writeFile("c.ts"));
            ctrl.editorGroups.activeGroup.cycleMru(1);

            expect(events.at(-1)).not.toBeNull();
            expect(events.at(-1)?.panes.map((pane) => pane.label)).toEqual(["c.ts", "b.ts"]);
        });

        it("focus moving to another group ends the previous one's cycle: null to the subscriber, the choice is committed", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.splitActiveGroup();
            ctrl.editorGroups.notifyGroupFocused(ctrl.editorGroups.groups[0]);
            const events = record(ctrl);

            ctrl.editorGroups.activeGroup.cycleMru(1); // series in g1: c → b
            expect(events.at(-1)).not.toBeNull();

            ctrl.editorGroups.notifyGroupFocused(ctrl.editorGroups.groups[1]);

            expect(events.at(-1)).toBeNull();
            expect(ctrl.editorGroups.groups[0].getMruOrder()[0]?.label).toBe("b.ts");
        });

        it("a cross-group cycleEditor during a cycle also ends it with null", () => {
            const ctrl = createEditorService();
            openThree(ctrl);
            ctrl.splitActiveGroup();
            ctrl.editorGroups.notifyGroupFocused(ctrl.editorGroups.groups[0]);
            const events = record(ctrl);

            ctrl.editorGroups.activeGroup.cycleMru(1); // series in g1
            ctrl.editorGroups.activeGroup.activateTab(0, { mru: true }); // stay in the series, on the strip's first tab
            ctrl.editorGroups.cycleEditor(-1); // step back across the strip boundary — into g2

            expect(events.at(-1)).toBeNull();
            expect(ctrl.editorGroups.activeGroup).toBe(ctrl.editorGroups.groups[1]);
        });
    });
});
