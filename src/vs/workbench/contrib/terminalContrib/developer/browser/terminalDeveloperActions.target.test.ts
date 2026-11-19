import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
// Which terminal Write Data writes into and reveals (upstream `getActiveOrCreateInstance` + `revealActiveTerminal`).
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import { PanelServiceDIToken } from "../../../../browser/parts/panel/panelService.ts";
import { EditorGroupsServiceDIToken } from "../../../../services/editor/common/editorGroupsService.ts";
import { PROBLEMS_VIEW_ID } from "../../../markers/browser/problemsComponent.ts";
import { TerminalEditorServiceDIToken } from "../../../terminal/browser/terminalEditorService.ts";
import {
    type ITerminalInstance,
    TERMINAL_VIEW_ID,
    TerminalServiceDIToken,
} from "../../../terminal/browser/terminalService.ts";

describe("Developer: Write Data to Terminal — target terminal", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-write-", files: { "a.txt": "A" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: `${ws.dir}/a.txt`,
            focusEditor: true,
            configurationService: createTestConfigurationService(settings),
        });
    }

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    async function writeData(text: string): Promise<void> {
        const done = h.commands.execute("workbench.action.terminal.writeDataToTerminal") as Promise<void>;
        await vi.waitFor(() => {
            h.testApp.render();
            expect(h.testApp.backend.screenToString()).toContain("bypassing the pty");
        });
        for (const key of text) h.testApp.sendKey(key);
        h.testApp.sendKey("Enter");
        await done;
    }

    const terminals = () => h.container.get(TerminalServiceDIToken);
    const fake = (instance: ITerminalInstance) => instance.session as FakeTerminalSurface;
    const printed = (index: number) => fake(terminals().getInstances()[index]).printed;

    it("the active panel terminal: the panel is shown again, no new terminal, the text goes to the emulator", async () => {
        boot();
        await h.commands.execute("workbench.action.terminal.new");
        await h.commands.execute("workbench.action.terminal.new");
        terminals().setActiveInstanceByIndex(0);
        h.container.get(PanelServiceDIToken).setActiveView(PROBLEMS_VIEW_ID);
        await writeData(String.raw`a\nb`);
        expect(terminals().getInstances()).toHaveLength(2);
        expect(printed(0)).toStrictEqual(["a\nb"]);
        expect(printed(1)).toStrictEqual([]);
        expect(fake(terminals().getInstances()[0]).writes).toStrictEqual([]);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(TERMINAL_VIEW_ID);
    });

    it("empty input writes nothing", async () => {
        boot();
        await writeData("");
        expect(printed(0)).toStrictEqual([]);
    });

    it("no terminal: one is created in the default location (editor) and written to", async () => {
        boot({ "terminal.integrated.defaultLocation": "editor" });
        await writeData("x");
        const [instance] = terminals().getEditorInstances();
        expect(terminals().getEditorInstances()).toHaveLength(1);
        expect(fake(instance).printed).toStrictEqual(["x"]);
    });

    it("the active terminal is an editor tab: its tab is revealed again and gets the focus back", async () => {
        boot();
        const editorTerminals = h.container.get(TerminalEditorServiceDIToken);
        const instance = editorTerminals.createTerminal();
        await h.commands.execute("workbench.action.files.newUntitledFile");
        const groups = h.container.get(EditorGroupsServiceDIToken);
        expect(groups.activeGroup.activePane).not.toBe(editorTerminals.paneOf(instance.id));
        await writeData("y");
        expect(fake(instance).printed).toStrictEqual(["y"]);
        expect(terminals().getInstances()).toHaveLength(0);
        expect(groups.activeGroup.activePane).toBe(editorTerminals.paneOf(instance.id));
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });
});
