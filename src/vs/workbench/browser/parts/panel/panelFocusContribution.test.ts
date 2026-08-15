import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { TerminalService, TerminalServiceDIToken } from "../../../contrib/terminal/browser/terminalService.ts";

const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";

/**
 * Регрессия на BUG-1/BUG-2 (#175): спрятанная панель не должна держать фокус.
 * Раньше `TerminalViewElement` оставался `activeElement` после `Ctrl+J` — ввод
 * уходил в невидимый шелл и там выполнялся.
 */
describe("PanelFocusContribution — фокус не остаётся на ушедшем со сцены содержимом панели", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let contextKeys: ContextKeyService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-panel-focus-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: `${ws.dir}/alpha.txt`, focusEditor: true });
        terminal = h.container.get(TerminalServiceDIToken);
        contextKeys = h.container.get(ContextKeyServiceDIToken);
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

    it("после скрытия панели фокус возвращается в редактор, а не остаётся на терминале", () => {
        h.commands.execute(TOGGLE_TERMINAL); // показать + сфокусировать терминал
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        h.commands.execute(TOGGLE_TERMINAL); // спрятать

        expect(h.testApp.focusedElement).toBeInstanceOf(EditorElement);
        expect(contextKeys.get("terminalFocus")).toBe(false);
    });

    it("ввод при скрытой панели идёт в редактор, а не в невидимый шелл", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        const surface = activeSurface();
        surface.writes.length = 0;

        h.commands.execute(TOGGLE_TERMINAL); // спрятать
        h.testApp.sendKey("x");

        expect(surface.writes).toEqual([]);
        expect(h.activeEditor().getText()).toContain("x");
    });

    it("без открытых редакторов фокус просто снимается со скрытого терминала", () => {
        const bare = createAppTestHarness({ workspaceFolder: ws.dir });
        try {
            bare.commands.execute(TOGGLE_TERMINAL);
            expect(bare.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

            bare.commands.execute(TOGGLE_TERMINAL);

            expect(bare.testApp.focusedElement).toBeNull();
        } finally {
            bare.dispose();
        }
    });

    it("уход с вкладки терминала на PROBLEMS тоже отпускает фокус", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        // Панель уже видима — команда лишь переключает активную вкладку.
        h.commands.execute("workbench.actions.view.problems");

        expect(h.testApp.focusedElement).not.toBeInstanceOf(TerminalViewElement);
    });

    it("фокус в редакторе скрытие панели не трогает", () => {
        h.commands.execute(TOGGLE_TERMINAL); // показать панель с терминалом
        h.workbench.focusEditor();
        const focused = h.testApp.focusedElement;
        expect(focused).toBeInstanceOf(EditorElement);

        h.commands.execute(TOGGLE_TERMINAL); // спрятать

        expect(h.testApp.focusedElement).toBe(focused);
    });
});
