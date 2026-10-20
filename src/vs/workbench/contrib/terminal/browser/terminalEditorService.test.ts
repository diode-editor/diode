import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { EditorPaneFactoriesDIToken } from "../../../services/editor/browser/editorPaneFactory.ts";
import { SIDE_GROUP } from "../../../services/editor/common/editorGroupColumn.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { lightPlusTheme } from "../../../services/themes/common/themes/lightPlus.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

import { TerminalColorsServiceDIToken } from "./terminalColorsService.ts";
import { TerminalEditorPane } from "./terminalEditorPane.ts";
import { TerminalEditorServiceDIToken } from "./terminalEditorService.ts";
import { TerminalServiceDIToken } from "./terminalService.ts";

// Вкладка-терминал в области редакторов на настоящем workbench: куда встаёт,
// что видно в кадре, и как связаны жизни вкладки и процесса.

const LIGHT = WorkbenchTheme.fromThemeFile(lightPlusTheme);

describe("TerminalEditorService", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function boot(): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-editor-", files: { "a.txt": "alpha\n" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 120, height: 30 },
        });
    }

    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };
    const service = () => h.container.get(TerminalEditorServiceDIToken);
    const terminals = () => h.container.get(TerminalServiceDIToken);
    const groups = () => h.container.get(EditorGroupsServiceDIToken);
    const sessionOf = (id: number) => terminals().getInstance(id)?.session as FakeTerminalSurface;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Beside — вкладка с именем терминала в новой группе справа, вывод в кадре, фокус в терминале", () => {
        boot();
        const instance = service().createTerminal({ name: "Claude Code" }, { viewColumn: SIDE_GROUP });
        sessionOf(instance.id).setGrid(["claude> ready"]);

        expect(groups().groups).toHaveLength(2);
        expect(groups().activeGroup).toBe(groups().groups[1]);
        const pane = groups().groups[1].activePane;
        expect(pane).toBeInstanceOf(TerminalEditorPane);
        expect(pane?.uri.toString()).toBe(`vscode-terminal:/${String(instance.id)}`);
        const frame = screen();
        expect(frame).toContain("Claude Code");
        expect(frame).toContain("claude> ready");
        expect(frame).toContain("alpha");
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        expect(service().paneOf(instance.id)).toBe(pane);
        // Вид TERMINAL про него не знает.
        expect(terminals().getInstances()).toStrictEqual([]);
        // Виджет адресуется селектором; вкладка — без замка и без выделения текста.
        expect(h.testApp.querySelector(`#terminalEditor-${String(instance.id)}`)).toBe(pane?.view);
        expect(pane?.readOnly).toBe(false);
        expect(pane?.getSelectedTexts()).toStrictEqual([]);
    });

    it("без колонки — активная группа; preserveFocus оставляет фокус и активную группу", () => {
        boot();
        const before = h.testApp.focusedElement;
        service().createTerminal({}, { viewColumn: SIDE_GROUP, preserveFocus: true });
        expect(groups().activeGroup).toBe(groups().groups[0]);
        expect(groups().groups[1].activePane).toBeInstanceOf(TerminalEditorPane);
        expect(h.testApp.focusedElement).toBe(before);

        service().createTerminal();
        expect(groups().groups[0].activePane).toBeInstanceOf(TerminalEditorPane);
    });

    it("preserveFocus при фокусе вне группы (терминал вида) — фокус остаётся там", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        h.testApp.render();
        const panelTerminal = h.testApp.focusedElement;
        expect(panelTerminal).toBeInstanceOf(TerminalViewElement);
        service().createTerminal({}, { viewColumn: SIDE_GROUP, preserveFocus: true });
        h.testApp.render();
        expect(h.testApp.focusedElement).toBe(panelTerminal);
    });

    it("hideFromUser — без вкладки, пока reveal её не откроет", () => {
        boot();
        const instance = service().createTerminal({ hideFromUser: true }, { viewColumn: SIDE_GROUP });
        expect(groups().groups).toHaveLength(1);
        expect(service().paneOf(instance.id)).toBeUndefined();

        terminals().showInstance(instance.id);
        service().reveal(instance.id, false);
        expect(groups().activeGroup.activePane).toBe(service().paneOf(instance.id));
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("reveal фонового с preserveFocus — вкладка открыта, фокус на месте", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        h.testApp.render();
        const before = h.testApp.focusedElement;
        const instance = service().createTerminal({ hideFromUser: true });
        terminals().showInstance(instance.id);
        service().reveal(instance.id, true);
        expect(service().paneOf(instance.id)).toBeDefined();
        h.testApp.render();
        expect(h.testApp.focusedElement).toBe(before);
    });

    it("reveal открытой вкладки активирует её: с фокусом — и группу, preserveFocus — только вкладку", () => {
        boot();
        const instance = service().createTerminal({}, { viewColumn: SIDE_GROUP });
        h.container.get(EditorServiceDIToken).openFile(`${ws.dir}/a.txt`, { group: groups().groups[1] });
        groups().focusGroup({ index: 0 });
        const pane = service().paneOf(instance.id);

        service().reveal(instance.id, true);
        expect(groups().groups[1].activePane).toBe(pane);
        expect(groups().activeGroup).toBe(groups().groups[0]);

        service().reveal(instance.id, false);
        expect(groups().activeGroup).toBe(groups().groups[1]);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        // Неизвестный id — ничего.
        service().reveal(999, false);
    });

    it("закрытие вкладки убивает процесс с причиной user", () => {
        boot();
        const instance = service().createTerminal({}, { viewColumn: SIDE_GROUP });
        const session = sessionOf(instance.id);
        const reasons: string[] = [];
        terminals().onDidDisposeInstance((i) => reasons.push(i.exitReason));

        const pane = service().paneOf(instance.id);
        const disposeSpy = vi.spyOn(TerminalViewElement.prototype, "dispose");
        const group = groups().groups[1];
        void h.container.get(EditorServiceDIToken).closeEditor(group, 0);
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        disposeSpy.mockRestore();
        expect(session.disposed).toBe(true);
        // Снятая вкладка свои события больше не шлёт.
        const changes = vi.fn();
        pane?.onDidChangeState(changes);
        pane?.refreshLabel();
        expect(changes).not.toHaveBeenCalled();
        expect(reasons).toStrictEqual(["user"]);
        expect(terminals().getEditorInstances()).toStrictEqual([]);
        expect(service().paneOf(instance.id)).toBeUndefined();
        expect(screen()).not.toContain("bash");
    });

    it("выход процесса закрывает вкладку (и пустую группу)", () => {
        boot();
        const instance = service().createTerminal({ name: "Claude Code" }, { viewColumn: SIDE_GROUP });
        expect(screen()).toContain("Claude Code");

        sessionOf(instance.id).emitExit(0);
        expect(service().paneOf(instance.id)).toBeUndefined();
        expect(screen()).not.toContain("Claude Code");
        expect(groups().groups).toHaveLength(1);
    });

    it("waitOnExit: вкладка ждёт клавишу, закрывается по ней", () => {
        boot();
        const instance = service().createTerminal({ waitOnExit: true }, { viewColumn: SIDE_GROUP });
        const session = sessionOf(instance.id);
        session.emitExit(1);
        expect(service().paneOf(instance.id)).toBeDefined();
        session.write("x");
        expect(service().paneOf(instance.id)).toBeUndefined();
    });

    it("смена заголовка терминала вида вкладок не трогает", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        const [panel] = terminals().getInstances();
        terminals().closeInstance(panel.id);
        const waiting = terminals().createInstance({ name: "task", waitOnExit: true });
        sessionOf(waiting.id).emitExit(0);
        expect(() => terminals().relaunchInstance(waiting.id, { name: "task 2" })).not.toThrow();
    });

    it("смена темы перекрашивает палитру вкладки-терминала", () => {
        boot();
        const instance = service().createTerminal();
        h.container.get(ThemeServiceDIToken).setTheme(LIGHT);
        expect(sessionOf(instance.id).ansiColors?.[2]).toBe(LIGHT.getRequiredColor("terminal.ansiGreen"));
    });

    it("контекст-ключ фокуса без элемента в фокусе — ложь", () => {
        boot();
        service().createTerminal();
        const keys = h.container.get(ContextKeyServiceDIToken);
        service().updateContextKeys(keys, null);
        expect(keys.get("terminalEditorFocus")).toBe(false);
    });

    it("смена заголовка перерисовывает метку вкладки", () => {
        boot();
        const instance = service().createTerminal({ name: "one", waitOnExit: true }, { viewColumn: SIDE_GROUP });
        sessionOf(instance.id).emitExit(0);
        terminals().relaunchInstance(instance.id, { name: "two" });
        const frame = screen();
        expect(frame).toContain("two");
        expect(frame).not.toContain("one ×");
    });

    it("moveToEditor и обратно moveToPanel: процесс тот же, вывод на месте", () => {
        boot();
        h.commands.execute("workbench.action.terminal.new");
        const instance = terminals().getInstances()[0];
        sessionOf(instance.id).setGrid(["panel output"]);

        service().moveToEditor(instance.id, { viewColumn: SIDE_GROUP });
        expect(terminals().getInstances()).toStrictEqual([]);
        expect(groups().groups[1].activePane).toBe(service().paneOf(instance.id));
        expect(screen()).toContain("panel output");

        service().moveToPanel(instance.id);
        expect(service().paneOf(instance.id)).toBeUndefined();
        expect(terminals().getInstances()).toStrictEqual([instance]);
        expect(sessionOf(instance.id).disposed).toBe(false);
        expect(groups().groups).toHaveLength(1);
        // Не тот id — ничего.
        service().moveToPanel(999);
        service().moveToEditor(999);
    });

    it("splitInstance — справа от группы родителя", () => {
        boot();
        const parent = service().createTerminal({}, { viewColumn: SIDE_GROUP });
        groups().focusGroup({ index: 0 });
        const child = service().splitInstance(parent.id, { name: "child" });
        expect(groups().groups).toHaveLength(3);
        expect(groups().groups[2].activePane).toBe(service().paneOf(child.id));
        // Родителя нет — от активной группы.
        const orphan = service().splitInstance(999);
        expect(service().paneOf(orphan.id)).toBeDefined();
    });

    it("цвета терминала доезжают до сессии вкладки", () => {
        boot();
        const instance = service().createTerminal();
        const colors = h.container.get(TerminalColorsServiceDIToken);
        expect(sessionOf(instance.id).ansiColors).toStrictEqual(colors.colors.ansi);
    });

    it("контекст-ключи: terminalEditorFocus и terminalEditorActive", () => {
        boot();
        const keys = h.container.get(ContextKeyServiceDIToken);
        const refresh = () => {
            h.container.get(WorkbenchContextKeysDIToken).update();
        };
        service().createTerminal({}, { viewColumn: SIDE_GROUP });
        refresh();
        expect(keys.get("terminalEditorFocus")).toBe(true);
        expect(keys.get("terminalEditorActive")).toBe(true);
        expect(keys.get("terminalFocus")).toBe(true);

        groups().focusGroup({ index: 0 });
        refresh();
        expect(keys.get("terminalEditorFocus")).toBe(false);
        expect(keys.get("terminalEditorActive")).toBe(false);
    });

    it("сплит вкладки-терминала заводит в новой группе НОВЫЙ терминал", () => {
        boot();
        const instance = service().createTerminal();
        h.commands.execute("workbench.action.splitEditor");
        expect(groups().groups).toHaveLength(2);
        const copy = groups().groups[1].activePane;
        expect(copy).toBeInstanceOf(TerminalEditorPane);
        expect((copy as TerminalEditorPane).instance.id).not.toBe(instance.id);
        expect(terminals().getEditorInstances()).toHaveLength(2);
        expect(groups().groups[0].editorCount).toBe(2);
        h.testApp.render();
        expect(h.testApp.focusedElement).toBe(copy?.view);
    });

    it("фабрика вкладки открывает новый терминал ровно в указанной группе, без фокуса — без фокуса", async () => {
        boot();
        h.commands.execute("workbench.action.splitEditor");
        const [first, second] = groups().groups;
        expect(groups().activeGroup).toBe(second);
        const factory = h.container
            .get(EditorPaneFactoriesDIToken)
            .find((f) => f.typeId === "workbench.editors.terminal");
        h.testApp.render();
        const before = h.testApp.focusedElement;
        await factory?.open({}, { group: first, focus: false });
        expect(first.activePane).toBeInstanceOf(TerminalEditorPane);
        expect(second.activePane).not.toBeInstanceOf(TerminalEditorPane);
        h.testApp.render();
        expect(h.testApp.focusedElement).toBe(before);
        // Рецепт — у вкладки-терминала; рестарт она не переживает.
        expect(factory?.describe(first.activePane as TerminalEditorPane)).toStrictEqual({});
        expect(factory?.describe(second.activePane as never)).toBeUndefined();
        expect(factory?.serialize({})).toBeUndefined();
        expect(factory?.deserialize("")).toBeUndefined();
    });
});
