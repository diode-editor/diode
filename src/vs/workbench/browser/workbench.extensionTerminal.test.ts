import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ExtensionTerminalAdapter } from "../contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TerminalEditorServiceDIToken } from "../contrib/terminal/browser/terminalEditorService.ts";
import {
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";
import { ExtensionPtySessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";

import { PanelServiceDIToken } from "./parts/panel/panelService.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";

describe("Workbench — extension terminal", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let adapter: ExtensionTerminalAdapter;

    function boot(files: Readonly<Record<string, string>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-ext-terminal-", files });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        terminal = h.container.get(TerminalServiceDIToken);
        adapter = new ExtensionTerminalAdapter(
            terminal,
            h.container.get(ViewsServiceDIToken),
            h.container.get(ExtensionPtySessionFactoryDIToken),
            h.container.get(TerminalEditorServiceDIToken),
            h.container.get(IConfigurationServiceDIToken),
        );
    }

    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("show opens the TERMINAL panel with the extension shell output and focuses it", () => {
        boot();
        adapter.create({ extHostId: 1, name: "Bazel Java: cleanup" });
        expect(screen()).not.toContain("==> done");

        const session = terminal.getInstances()[0].session as FakeTerminalSurface;
        session.setGrid(["==> done"]);
        adapter.show({ extHostId: 1 }, false);
        const frame = screen();
        expect(frame).toContain("TERMINAL");
        expect(frame).toContain("==> done");
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        adapter.hide({ extHostId: 1 });
        expect(screen()).not.toContain("==> done");
    });

    it("next to the user's shell — the extension terminal name in the tab list", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        adapter.create({ extHostId: 1, name: "Bazel Build Status" });
        adapter.show({ extHostId: 1 }, true);
        const tabs = screen()
            .split("\n")
            .filter((line) => line.includes("│ "));
        // The tab list is narrow — the long name is truncated to fit.
        expect(tabs.some((line) => line.includes("Bazel Build Statu"))).toBe(true);
        expect(tabs.some((line) => line.trimEnd().endsWith(" bash"))).toBe(true);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(TERMINAL_VIEW_ID);
    });

    // The stock Claude Code extension runs `claude` in a terminal tab beside the file and, after a diff
    // or an accepted edit, returns focus with `window.activeTerminal?.show()`.
    it("activeTerminal is the terminal tab, not the hidden panel shell: show() does not open the panel", () => {
        boot({ "a.txt": "alpha\n" });
        const views = h.container.get(ViewsServiceDIToken);
        h.commands.execute("workbench.action.terminal.new");
        views.closeView(TERMINAL_VIEW_ID);
        const active: (number | null)[] = [];
        adapter.subscribe({
            opened: () => undefined,
            closed: () => undefined,
            activeChanged: (id) => active.push(id),
            ptyStart: () => undefined,
            ptyInput: () => undefined,
            ptyResize: () => undefined,
        });
        adapter.create({ extHostId: 1, name: "Claude Code", location: { viewColumn: -2 } });
        const claude = terminal.getEditorInstances()[0];
        expect(active).toEqual([claude.id]);

        // A file tab becoming active does not reset the editor host's terminal.
        h.workbench.openFile(ws.path("a.txt"));
        expect(active).toEqual([claude.id]);
        expect(adapter.snapshot().activeId).toBe(claude.id);

        adapter.show({ id: claude.id }, false);
        expect(views.isViewShown(TERMINAL_VIEW_ID)).toBe(false);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("a new panel terminal takes over; closing it hands back to the terminal tab", () => {
        boot();
        adapter.create({ extHostId: 1, name: "Claude Code", location: 2 });
        const claude = terminal.getEditorInstances()[0];
        h.commands.execute("workbench.action.terminal.new");
        const shell = terminal.getInstances()[0];
        expect(terminal.getActiveInstanceAcrossHosts()).toBe(shell);

        terminal.closeInstance(shell.id);
        expect(terminal.getActiveInstanceAcrossHosts()).toBe(claude);

        terminal.closeInstance(claude.id);
        expect(terminal.getActiveInstanceAcrossHosts()).toBeNull();
    });

    it("show(preserveFocus) of a terminal tab in an inactive group makes it the active terminal", () => {
        boot({ "a.txt": "alpha\n" });
        h.workbench.openFile(ws.path("a.txt"));
        adapter.create({ extHostId: 1, name: "Claude Code", location: { viewColumn: -2, preserveFocus: true } });
        const claude = terminal.getEditorInstances()[0];
        h.commands.execute("workbench.action.terminal.new");
        expect(terminal.getActiveInstanceAcrossHosts()).not.toBe(claude);

        adapter.show({ id: claude.id }, true);

        expect(terminal.getActiveInstanceAcrossHosts()).toBe(claude);
        expect(h.container.get(ViewsServiceDIToken).isViewShown(TERMINAL_VIEW_ID)).toBe(true);
    });
});
