import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { makeTask } from "../../../TestUtils/taskFixtures.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { type TaskService, TaskServiceDIToken } from "../contrib/tasks/browser/taskService.ts";
import { TerminalEditorPane } from "../contrib/terminal/browser/terminalEditorPane.ts";
import { type TerminalService, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";

import { PanelServiceDIToken } from "./parts/panel/panelService.ts";

describe("Workbench: a task terminal moved into the editor area", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let tasks: TaskService;

    function boot(): void {
        ws = createTempWorkspace({ prefix: "diode-task-editor-", files: { "a.txt": "alpha\n" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 120, height: 30 },
        });
        terminal = h.container.get(TerminalServiceDIToken);
        tasks = h.container.get(TaskServiceDIToken);
    }

    const groups = () => h.container.get(EditorGroupsServiceDIToken);
    const panel = () => h.container.get(PanelServiceDIToken);
    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the rerun brings the tab forward over the file, the panel stays closed", async () => {
        boot();
        const task = makeTask({ label: "hi" });
        const first = tasks.run(task);
        await vi.waitFor(() => {
            expect(terminal.getInstances()).toHaveLength(1);
        });
        const session = terminal.getInstances()[0].session as FakeTerminalSurface;
        session.setGrid(["hi"]);
        session.emitExit(0);
        await first;
        h.commands.execute("workbench.action.terminal.moveToEditor");
        h.commands.execute("workbench.action.closePanel");
        // The file goes in front of the terminal tab.
        groups().activeGroup.activateTab(0, { focus: true });
        expect(screen()).toContain("alpha");

        void tasks.run(task);
        await vi.waitFor(() => {
            expect(groups().activeGroup.activePane).toBeInstanceOf(TerminalEditorPane);
        });
        // The reused terminal relaunches the same session.
        session.setGrid(["second run: hi"]);
        session.emitUpdate();
        const frame = screen();
        expect(frame).toContain("second run: hi");
        expect(frame).not.toContain("alpha");
        expect(frame).not.toContain("TERMINAL");
        expect(panel().visible).toBe(false);
        expect(terminal.getActiveInstanceAcrossHosts()?.id).toBe(1);
    });
});
