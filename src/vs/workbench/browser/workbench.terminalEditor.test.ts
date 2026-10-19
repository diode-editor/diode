import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import { TerminalEditorPane } from "../contrib/terminal/browser/terminalEditorPane.ts";
import { TerminalEditorServiceDIToken } from "../contrib/terminal/browser/terminalEditorService.ts";
import {
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import type { EditorTitleMenuContext } from "./actions/menuContexts.ts";
import { PanelServiceDIToken } from "./parts/panel/panelService.ts";

// Команды терминала в области редакторов — из палитры, клавишами и меню
// вкладок, как их зовёт человек.

describe("Workbench — терминал в области редакторов", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-editor-", files: { "a.txt": "alpha\n" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 120, height: 30 },
            configurationService: createTestConfigurationService(settings),
        });
        terminal = h.container.get(TerminalServiceDIToken);
    }

    const groups = () => h.container.get(EditorGroupsServiceDIToken);
    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Create New Terminal in Editor Area to the Side — группа справа, шелл в кадре рядом с файлом", () => {
        boot();
        h.commands.execute("workbench.action.createTerminalEditorSide");
        const [instance] = terminal.getEditorInstances();
        (instance.session as FakeTerminalSurface).setGrid(["$ prompt"]);
        const frame = screen();
        expect(frame).toContain("alpha");
        expect(frame).toContain("$ prompt");
        expect(frame).toContain("bash");
        expect(groups().groups).toHaveLength(2);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Create New Terminal in Editor Area — в активную группу", () => {
        boot();
        h.commands.execute("workbench.action.createTerminalEditor");
        expect(groups().groups).toHaveLength(1);
        expect(groups().activeGroup.activePane).toBeInstanceOf(TerminalEditorPane);
    });

    it("Ctrl+W во вкладке-терминале закрывает её и убивает процесс; в шелл клавиша не уходит", () => {
        boot();
        h.commands.execute("workbench.action.createTerminalEditorSide");
        const session = terminal.getEditorInstances()[0].session as FakeTerminalSurface;
        h.testApp.render();
        h.testApp.sendKey("Ctrl+W");
        expect(session.writes).toStrictEqual([]);
        expect(session.disposed).toBe(true);
        expect(groups().groups).toHaveLength(1);
        expect(screen()).toContain("alpha");
    });

    it("Ctrl+W в терминале вида TERMINAL остаётся шеллу", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        const session = terminal.getInstances()[0].session as FakeTerminalSurface;
        h.testApp.render();
        h.testApp.sendKey("Ctrl+W");
        expect(session.disposed).toBe(false);
        expect(session.writes).toStrictEqual(["\x17"]);
    });

    it("Ctrl+PgDn во вкладке-терминале листает вкладки, а не терминалы вида", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        h.commands.execute("workbench.action.terminal.new");
        h.commands.execute("workbench.action.createTerminalEditor");
        const active = terminal.getActiveInstance();
        h.testApp.render();
        h.testApp.sendKey("Ctrl+PageDown");
        expect(terminal.getActiveInstance()).toBe(active);
        expect(groups().activeGroup.activePane).not.toBeInstanceOf(TerminalEditorPane);
    });

    it("defaultLocation: editor — Create New Terminal открывает вкладку, вид не трогает", () => {
        boot({ "terminal.integrated.defaultLocation": "editor" });
        h.commands.execute("workbench.action.terminal.new");
        expect(terminal.getInstances()).toStrictEqual([]);
        expect(groups().activeGroup.activePane).toBeInstanceOf(TerminalEditorPane);
        expect(h.container.get(PanelServiceDIToken).visible).toBe(false);
    });

    it("Move Terminal into Editor Area — из меню вкладки терминала и из палитры", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        h.commands.execute("workbench.action.terminal.new");
        const [first, second] = terminal.getInstances();
        const entries = h.container.get(MenuRegistryDIToken).getMenuItems(MenuId.TerminalTabContext, {
            instanceId: first.id,
        });
        const move = entries.find(
            (e) => e.type !== "separator" && "label" in e && e.label === "Move Terminal into Editor Area",
        );
        (move as { onSelect?: () => void }).onSelect?.();
        expect(terminal.getInstances()).toStrictEqual([second]);
        expect(groups().activeGroup.activePane).toBe(h.container.get(TerminalEditorServiceDIToken).paneOf(first.id));

        // Из палитры — активный терминал вида.
        h.commands.execute("workbench.action.terminal.moveToEditor");
        expect(terminal.getInstances()).toStrictEqual([]);
        expect(terminal.getEditorInstances()).toStrictEqual([first, second]);
    });

    it("Move Terminal into Panel — только в меню вкладки-терминала; возвращает в вид TERMINAL", () => {
        boot();
        h.commands.execute("workbench.action.createTerminalEditor");
        const [instance] = terminal.getEditorInstances();
        const menu = (index: number) => {
            const context: EditorTitleMenuContext = {
                groupId: groups().activeGroup.id,
                index,
                path: null,
                resourceScheme: groups().activeGroup.getPane(index)?.uri.scheme ?? "",
                tabCount: 2,
                hasTabsToTheRight: index === 0,
                hasSavedTabs: true,
                isPreview: false,
            };
            return h.container
                .get(MenuRegistryDIToken)
                .getMenuItems(MenuId.EditorTitleContext, context)
                .filter((e) => e.type !== "separator" && "label" in e && e.label === "Move Terminal into Panel");
        };
        expect(menu(0)).toHaveLength(0);
        const [move] = menu(1);
        (move as { onSelect?: () => void }).onSelect?.();

        expect(terminal.getInstances()).toStrictEqual([instance]);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        expect(
            groups()
                .activeGroup.getPanes()
                .some((p) => p instanceof TerminalEditorPane),
        ).toBe(false);
    });

    it("Move Terminal into Panel без вкладки-терминала — ничего, и в пустой группе тоже", async () => {
        boot();
        h.commands.execute("workbench.action.terminal.moveToTerminalPanel");
        h.commands.execute("workbench.action.terminal.moveToEditor");
        expect(terminal.getInstances()).toStrictEqual([]);
        await h.container.get(EditorServiceDIToken).closeAllEditors(groups().activeGroup);
        expect(() => h.commands.execute("workbench.action.terminal.moveToTerminalPanel")).not.toThrow();
    });

    it("Kill the Active Terminal in Editor Area не трогает вкладку другого вида", () => {
        boot();
        h.commands.execute("workbench.action.terminal.killEditor");
        expect(groups().activeGroup.editorCount).toBe(1);
        expect(screen()).toContain("alpha");
    });
});
