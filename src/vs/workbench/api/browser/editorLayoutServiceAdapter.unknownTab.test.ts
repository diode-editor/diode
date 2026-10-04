import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { EditorGroupsServiceDIToken } from "../../services/editor/browser/editorGroupsService.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

import { EditorLayoutServiceAdapter } from "./editorLayoutServiceAdapter.ts";

/**
 * Вкладка не текстового и не дифф-вида (Keyboard Shortcuts) в снимке для
 * `window.tabGroups`: настоящая вкладка из настоящей команды, а не фейк.
 */
describe("EditorLayoutServiceAdapter — вкладка чужого вида", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let adapter: EditorLayoutServiceAdapter;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-layout-unknown-", files: { "a.ts": "alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        adapter = new EditorLayoutServiceAdapter(
            h.container.get(EditorServiceDIToken),
            h.container.get(EditorGroupsServiceDIToken),
        );
    });

    afterEach(() => {
        adapter.dispose();
        h.dispose();
        ws.dispose();
    });

    it("Keyboard Shortcuts уходит как kind=unknown, а не как текст по своему uri", () => {
        h.workbench.openFile(ws.path("a.ts"));
        h.commands.execute("workbench.action.openGlobalKeybindings");

        const tabs = adapter.getLayoutSnapshot().groups[0].tabs;

        expect(tabs.map((tab) => tab.kind)).toEqual(["text", "unknown"]);
        expect(tabs[1]).toEqual({
            uri: "keybindings:global",
            label: tabs[1].label,
            isActive: true,
            isDirty: false,
            kind: "unknown",
        });
    });
});
