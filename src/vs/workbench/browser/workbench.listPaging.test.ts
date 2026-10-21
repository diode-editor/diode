import { Size } from "@tuidom/core/common/geometryPromitives";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";

import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";

/**
 * Regression: the paired keypress was suppressed only over a text input, and PageDown
 * moved the list cursor by two pages (the command + the ListViewElement default).
 */
describe("Workbench — a key over a list fires exactly once", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let list: ListViewElement;
    let commands: CommandRegistry;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-list-paging-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 40) });
        commands = h.container.get(CommandRegistryDIToken);
        await h.workbench.activate();

        h.container.get(SidebarServiceDIToken).showViewlet("search", false);
        list = h.testApp.querySelector("#searchResults") as ListViewElement;
        for (let i = 0; i < 100; i++) {
            const row = new TextLabelElement(`row ${String(i)}`);
            row.id = `row-${String(i)}`;
            list.appendRow(row);
        }
        list.focus();
        // Two frames: the first render after filling still changes the list height
        // (the scrollbar settles) — calibrating "one page" must use the same
        // geometry as the keyboard path.
        h.testApp.render();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function cursorIndex(): number {
        const id = list.getCursorElement()?.id ?? "";
        return Number(id.replace("row-", ""));
    }

    it("PageDown moves the cursor exactly one page (not two)", () => {
        // Calibration: a bare command call gives "one page" without the keyboard path.
        commands.execute("list.focusPageDown");
        h.testApp.render();
        const onePage = cursorIndex();
        expect(onePage).toBeGreaterThan(0);

        commands.execute("list.focusFirst");
        h.testApp.render();
        expect(cursorIndex()).toBe(0);

        h.testApp.sendKey("PageDown");
        h.testApp.render();
        expect(cursorIndex()).toBe(onePage);
    });

    it("End + PageUp via the keyboard match the pure commands", () => {
        h.testApp.sendKey("End");
        h.testApp.render();
        expect(cursorIndex()).toBe(99);

        commands.execute("list.focusPageUp");
        h.testApp.render();
        const onePageUp = cursorIndex();
        expect(onePageUp).toBeLessThan(99);

        commands.execute("list.focusLast");
        h.testApp.render();
        h.testApp.sendKey("PageUp");
        h.testApp.render();
        expect(cursorIndex()).toBe(onePageUp);
    });
});
