import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../base/common/uri.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { TerminalEditorPane } from "../contrib/terminal/browser/terminalEditorPane.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";

/** nf-cod-lock: the title's Unlock Group button. */
const LOCK_GLYPH = "";

// The Claude Code layout: `claude` runs in a terminal tab beside the file (`ViewColumn.Beside`), and
// focus stays in it while the agent works. Opening a file from the Source Control view must not land there.
describe("Workbench: locked editor group (terminal beside the file)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-group-lock-", files: { "a.txt": "alpha\n", "b.txt": "bravo\n" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 120, height: 20 },
            configurationService: createTestConfigurationService(settings),
        });
        h.commands.execute("workbench.action.createTerminalEditorSide");
    }

    const groups = () => h.container.get(EditorGroupsServiceDIToken);
    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };
    const tabRow = (): string => screen().split("\n")[1];
    const openFromScm = (name: string) => h.commands.execute("scm.action.openFile", Uri.file(ws.path(name)).toString());

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the terminal's group locks itself, shows the unlock button, and Open File goes to the file's group", async () => {
        boot();
        const [left, right] = groups().groups;
        expect(right.isLocked).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        expect(h.container.get(ContextKeyServiceDIToken).get("activeEditorGroupLocked")).toBe(true);
        // The button is in the right group's half of the tab row only.
        const row = tabRow();
        expect(row.indexOf(LOCK_GLYPH)).toBeGreaterThan(row.indexOf("bash ×"));

        await openFromScm("b.txt");

        expect(groups().groups).toEqual([left, right]);
        expect(left.getPanes().map((pane) => pane.label)).toEqual(["a.txt", "b.txt"]);
        expect(right.activePane).toBeInstanceOf(TerminalEditorPane);
        expect(groups().activeGroup).toBe(left);
        expect(screen()).toContain("bravo");
    });

    it("Unlock Group from the palette: the button goes away and the next file opens into the terminal's group", async () => {
        boot();
        const [, right] = groups().groups;
        h.commands.execute("workbench.action.unlockEditorGroup");
        expect(right.isLocked).toBe(false);
        expect(tabRow()).not.toContain(LOCK_GLYPH);

        await openFromScm("b.txt");
        expect(right.getPanes().map((pane) => pane.label)).toContain("b.txt");
    });

    it("`terminalEditor: false` in workbench.editor.autoLockGroups keeps the upstream-off behavior", () => {
        boot({ "workbench.editor.autoLockGroups": { terminalEditor: false } });
        expect(groups().groups[1].isLocked).toBe(false);
        expect(tabRow()).not.toContain(LOCK_GLYPH);
    });

    it("Toggle Editor Group Lock locks the active file group, and opening then picks a new group", async () => {
        boot();
        const [left, right] = groups().groups;
        groups().focusGroup(left.id);
        h.commands.execute("workbench.action.toggleEditorGroupLock");
        expect(left.isLocked).toBe(true);

        await openFromScm("b.txt");
        expect(groups().groups).toHaveLength(3);
        expect(
            groups()
                .groups[1].getPanes()
                .map((pane) => pane.label),
        ).toEqual(["b.txt"]);
        expect(groups().groups[2]).toBe(right);
    });
});
