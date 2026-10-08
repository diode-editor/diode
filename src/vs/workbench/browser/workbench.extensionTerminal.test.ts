import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ExtensionTerminalAdapter } from "../contrib/terminal/browser/extensionTerminalAdapter.ts";
import {
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";

import { PanelServiceDIToken } from "./parts/panel/panelService.ts";

// Терминал расширения в кадре: сток `window.createTerminal` (тот же адаптер, что
// в extensionHostModule) поверх настоящего workbench. Провод и субпроцесс —
// terminalCustomer.test.ts; здесь — что видит человек.

describe("Workbench — терминал расширения", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let adapter: ExtensionTerminalAdapter;

    function boot(): void {
        ws = createTempWorkspace({ prefix: "diode-ext-terminal-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        terminal = h.container.get(TerminalServiceDIToken);
        adapter = new ExtensionTerminalAdapter(terminal, h.container.get(PanelServiceDIToken));
    }

    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("show открывает панель TERMINAL с выводом шелла расширения и отдаёт ему фокус", () => {
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

    it("рядом с шеллом человека — имя терминала расширения в списке вкладок", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        adapter.create({ extHostId: 1, name: "Bazel Build Status" });
        adapter.show({ extHostId: 1 }, true);
        const tabs = screen()
            .split("\n")
            .filter((line) => line.includes("│ "));
        // Список вкладок узкий — длинное имя срезано по ширине.
        expect(tabs.some((line) => line.includes("Bazel Build Statu"))).toBe(true);
        expect(tabs.some((line) => line.trimEnd().endsWith(" bash"))).toBe(true);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(TERMINAL_VIEW_ID);
    });
});
