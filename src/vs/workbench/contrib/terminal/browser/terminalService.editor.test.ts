import { describe, expect, it } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";

function buildHarness(settings: Record<string, unknown> = {}) {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const service = new TerminalService(views.service, createTestConfigurationService(settings), (options) => {
        const surface = new FakeTerminalSurface(options.shell ?? "/bin/bash");
        sessions.push(surface);
        return surface;
    });
    views.service.attachRegisteredContainers();
    views.panelService.setActiveView(TERMINAL_VIEW_ID);
    views.panelService.setVisible(true);
    const events: string[] = [];
    service.onDidCreateInstance((i) => events.push(`create:${String(i.id)}`));
    service.onDidOpenInstance((i) => events.push(`open:${String(i.id)}`));
    service.onDidCloseInstance((i) => events.push(`close:${String(i.id)}`));
    service.onDidDisposeInstance((i) => events.push(`dispose:${String(i.id)}:${i.exitReason}`));
    service.onDidChangeActiveInstance((i) => events.push(`active:${i === null ? "null" : String(i.id)}`));
    return { views, service, sessions, events };
}

describe("TerminalService — instances in the editor area", () => {
    it("editor terminal: only create, not in the view list, the active one doesn't change", () => {
        const h = buildHarness();
        const panel = h.service.createInstance();
        h.events.length = 0;
        const editor = h.service.createInstance({ target: "editor", name: "Claude Code" });

        expect(editor.target).toBe("editor");
        expect(panel.target).toBe("panel");
        expect(h.events).toStrictEqual([`create:${String(editor.id)}`]);
        expect(h.service.getInstances()).toStrictEqual([panel]);
        expect(h.service.getEditorInstances()).toStrictEqual([editor]);
        expect(h.service.getActiveInstance()).toBe(panel);
        expect(h.service.getInstance(editor.id)).toBe(editor);
        h.service.dispose();
    });

    it("process exit removes an editor terminal without close or an active change; the view isn't hidden", () => {
        const h = buildHarness();
        const panel = h.service.createInstance();
        const editor = h.service.createInstance({ target: "editor" });
        h.events.length = 0;

        h.sessions[1].emitExit(0);
        expect(h.events).toStrictEqual([`dispose:${String(editor.id)}:process`]);
        expect(h.service.getEditorInstances()).toStrictEqual([]);
        expect(h.service.getInstance(editor.id)).toBeNull();
        expect(h.service.getActiveInstance()).toBe(panel);
        expect(h.views.panelService.visible).toBe(true);
        h.service.dispose();
    });

    it("sendText and closeInstance find an editor terminal by id", () => {
        const h = buildHarness();
        const editor = h.service.createInstance({ target: "editor" });
        h.service.sendText(editor.id, "ls", true);
        expect(h.sessions[0].writes).toStrictEqual(["ls\r"]);
        h.service.closeInstance(editor.id, "extension");
        expect(h.events.at(-1)).toBe(`dispose:${String(editor.id)}:extension`);
        expect(h.sessions[0].disposed).toBe(true);
        h.service.dispose();
    });

    it("showing a background editor terminal moves it to the editor area, not the view", () => {
        const h = buildHarness();
        const hidden = h.service.createInstance({ target: "editor", hideFromUser: true });
        expect(h.service.getBackgroundInstances()).toStrictEqual([hidden]);
        expect(h.service.getEditorInstances()).toStrictEqual([]);
        h.events.length = 0;

        h.service.showInstance(hidden.id);
        expect(h.service.getBackgroundInstances()).toStrictEqual([]);
        expect(h.service.getEditorInstances()).toStrictEqual([hidden]);
        expect(h.service.getInstances()).toStrictEqual([]);
        expect(h.events).toStrictEqual([]);
        h.service.dispose();
    });

    it("moveToEditor: the view tab leaves and the active one changes, the process lives", () => {
        const h = buildHarness();
        const first = h.service.createInstance();
        const second = h.service.createInstance();
        h.events.length = 0;

        expect(h.service.moveToEditor(second.id)).toBe(second);
        expect(second.target).toBe("editor");
        expect(h.events).toStrictEqual([`close:${String(second.id)}`, `active:${String(first.id)}`]);
        expect(h.service.getInstances()).toStrictEqual([first]);
        expect(h.service.getEditorInstances()).toStrictEqual([second]);
        expect(h.sessions[1].disposed).toBe(false);
        expect(h.service.moveToEditor(second.id)).toBeUndefined();
        expect(h.service.moveToEditor(99)).toBeUndefined();
        h.service.dispose();
    });

    it("moveToEditor of the last one hides the view (hideOnLastClosed), the process lives", () => {
        const h = buildHarness();
        const only = h.service.createInstance();
        h.service.moveToEditor(only.id);
        expect(h.service.getActiveInstance()).toBeNull();
        expect(h.views.panelService.visible).toBe(false);
        expect(h.sessions[0].disposed).toBe(false);
        h.service.dispose();
    });

    it("moveToPanel: becomes last and active, same process", () => {
        const h = buildHarness();
        const panel = h.service.createInstance();
        const editor = h.service.createInstance({ target: "editor" });
        const other = h.service.createInstance({ target: "editor" });
        h.events.length = 0;

        expect(h.service.moveToPanel(editor.id)).toBe(editor);
        expect(editor.target).toBe("panel");
        expect(h.events).toStrictEqual([`open:${String(editor.id)}`, `active:${String(editor.id)}`]);
        expect(h.service.getInstances()).toStrictEqual([panel, editor]);
        expect(h.service.getEditorInstances()).toStrictEqual([other]);
        expect(h.service.getActiveInstance()).toBe(editor);
        expect(h.service.moveToPanel(panel.id)).toBeUndefined();
        expect(h.service.moveToPanel(99)).toBeUndefined();
        h.service.dispose();
    });

    it("service dispose kills editor terminal processes too", () => {
        const h = buildHarness();
        h.service.createInstance({ target: "editor" });
        h.service.dispose();
        expect(h.sessions[0].disposed).toBe(true);
        expect(h.service.getEditorInstances()).toStrictEqual([]);
    });
});
