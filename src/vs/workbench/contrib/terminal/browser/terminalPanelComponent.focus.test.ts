import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TerminalViewElement } from "@tuidom/all/ui/terminal/terminalViewElement";
import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";

import type { TerminalService } from "./terminalService.ts";
import { TerminalServiceDIToken } from "./terminalService.ts";

const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";

/**
 * Регрессия на BUG-3 (#177): после `exit` виджет терминала снимают с дерева, и
 * FocusManager обнуляет фокус — ввод пропадал целиком (в редакторе не появлялся,
 * в панели тоже). Теперь фокус возвращается редактору (или следующему терминалу).
 */
describe("Терминал после выхода шелла отдаёт фокус", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-terminal-exit-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: `${ws.dir}/alpha.txt`, focusEditor: true });
        terminal = h.container.get(TerminalServiceDIToken);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function activeSurface(): FakeTerminalSurface {
        const instance = terminal.getActiveInstance();
        /* v8 ignore start -- тестовый хелпер: сценарий обязан открыть терминал до обращения к сессии */
        if (instance === null) throw new Error("expected an open terminal");
        /* v8 ignore stop */
        return instance.session as unknown as FakeTerminalSurface;
    }

    it("после exit фокус возвращается в редактор", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        activeSurface().emitExit(0);

        expect(h.testApp.focusedElement).toBeInstanceOf(EditorElement);
    });

    it("ввод после exit идёт в редактор, а не в никуда", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        activeSurface().emitExit(0);

        h.testApp.sendKey("x");

        expect(h.activeEditor().getText()).toContain("x");
    });
});
