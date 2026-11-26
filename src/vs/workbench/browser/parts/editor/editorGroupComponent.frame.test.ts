import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { TAB_HEIGHT } from "@tuidom/elements/editorgroup/editorTabItemElement";
import type { EditorTabStripElement } from "@tuidom/elements/editorgroup/editorTabStripElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { monokaiTheme } from "../../../services/themes/common/themes/monokai.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";
import { FrameElement } from "../frameElement.ts";

import { EditorTitleActionsBox } from "./editorTitleActionsBox.ts";

const BUTTON_WHEN = "demo.showTitleButton";

// Each editor group frames itself: the tabs' baseline is the frame's top line, a FrameElement with an
// open top closes the sides and the bottom around the editor, and the top-right corner `╮` comes from
// whatever ends the title row — the tab strip itself, or the title actions box when there are buttons.
describe("EditorGroupComponent — the group's frame", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-group-frame-", files: { "a.txt": "alpha\nbeta\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.txt"), size: new Size(80, 16) });
        h.commands.register("demo.button", () => undefined);
        h.container.get(MenuRegistryDIToken).appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.button",
            title: "Button",
            group: "navigation",
            when: BUTTON_WHEN,
        });
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function group(): OverlayHostElement {
        const id = h.container.get(EditorServiceDIToken).editorGroups.activeGroup.id;
        return h.testApp.querySelector(`#editorGroup-${String(id)}`) as OverlayHostElement;
    }

    function strip(): EditorTabStripElement {
        return group().querySelector("EditorTabStripElement") as EditorTabStripElement;
    }

    function bodyFrame(): FrameElement {
        const frame = group().getContent()!.getChildren()[1];
        expect(frame).toBeInstanceOf(FrameElement);
        return frame as FrameElement;
    }

    function text(x: number, y: number, width: number): string {
        return h.testApp.backend.getTextAt(new Point(x, y), width);
    }

    /** The group's right edge: the frame's right side and the `╮` above it. */
    function rightX(): number {
        return group().globalPosition.x + group().layoutSize.width - 1;
    }

    async function showButtons(value: boolean): Promise<void> {
        h.container.get(ContextKeyServiceDIToken).setRaw(BUTTON_WHEN, value);
        await new Promise<void>((resolve) => {
            queueMicrotask(resolve);
        });
        h.testApp.render();
    }

    it("the editor sits in an open-top frame: sides and bottom line, the tabs' baseline above it", () => {
        const g = group();
        const frame = bodyFrame();
        const editor = h.container.get(EditorServiceDIToken).getActiveEditor()!.view;
        const { x, y } = g.globalPosition;
        const { width, height } = g.layoutSize;

        expect(frame.openTop).toBe(true);
        expect(frame.getChild()).toBe(editor);
        expect(frame.globalPosition.y).toBe(y + TAB_HEIGHT);
        // The editor: one column in from each side, right under the tabs, above the bottom line.
        expect(editor.globalPosition.x).toBe(x + 1);
        expect(editor.globalPosition.y).toBe(y + TAB_HEIGHT);
        expect(editor.layoutSize.width).toBe(width - 2);
        expect(editor.layoutSize.height).toBe(height - TAB_HEIGHT - 1);
        for (let row = y + TAB_HEIGHT; row < y + height - 1; row++) {
            expect(text(x, row, 1), `left side, row ${row}`).toBe("│");
            expect(text(x + width - 1, row, 1), `right side, row ${row}`).toBe("│");
        }
        expect(text(x, y + height - 1, width)).toBe(`╰${"─".repeat(width - 2)}╯`);
        // No top line of its own: the row above the editor is the tabs' baseline.
        expect(text(x, y + TAB_HEIGHT - 1, 1)).not.toBe("╭");
    });

    it("without title buttons the tab strip spans the group and closes the frame with ╮ itself", () => {
        const baseline = group().globalPosition.y + TAB_HEIGHT - 1;

        expect(group().querySelector("EditorTitleActionsBox")).toBeNull();
        expect(strip().endCorner).toBe(true);
        expect(strip().globalPosition.x).toBe(group().globalPosition.x);
        expect(strip().layoutSize.width).toBe(group().layoutSize.width);
        expect(text(rightX(), baseline, 1)).toBe("╮");
    });

    it("with title buttons the strip leaves the corner to the actions box, which ends the title row with ╮", async () => {
        await showButtons(true);
        const baseline = group().globalPosition.y + TAB_HEIGHT - 1;
        const box = group().querySelector("EditorTitleActionsBox");

        expect(box).toBeInstanceOf(EditorTitleActionsBox);
        expect(strip().endCorner).toBe(false);
        // The strip stops where the box starts; the box reaches the group's right edge.
        expect(strip().globalPosition.x + strip().layoutSize.width).toBe(box!.globalPosition.x);
        expect(box!.globalPosition.x + box!.layoutSize.width - 1).toBe(rightX());
        expect(box!.layoutSize.height).toBe(TAB_HEIGHT);
        // One corner only: the strip's last column is plain baseline, the box's last one the corner.
        expect(text(box!.globalPosition.x - 1, baseline, 1)).not.toBe("╮");
        expect(text(rightX(), baseline, 1)).toBe("╮");
        expect(text(rightX(), baseline + 1, 1)).toBe("│");

        await showButtons(false);
        expect(strip().endCorner).toBe(true);
        expect(strip().layoutSize.width).toBe(group().layoutSize.width);
        expect(text(rightX(), baseline, 1)).toBe("╮");
    });
    /** fg of every frame line of the group: tab box corner, the tab's foot, baseline, ╮, sides and bottom. */
    function frameLineColors(): Map<string, number> {
        const { x, y } = group().globalPosition;
        const { width, height } = group().layoutSize;
        const baseline = y + TAB_HEIGHT - 1;
        const fg = (cx: number, cy: number): number => h.testApp.backend.getFgAt(new Point(cx, cy));
        expect(text(x, y, 1)).toBe("╭");
        expect(text(rightX(), baseline, 1)).toBe("╮");
        const free = rightX() - 1;
        expect(text(free, baseline, 1)).toBe("─");
        return new Map([
            ["tab ╭", fg(x, y)],
            ["tab side │", fg(x, y + 1)],
            ["tab foot", fg(x, baseline)],
            ["baseline ─", fg(free, baseline)],
            ["corner ╮", fg(rightX(), baseline)],
            ["left side │", fg(x, baseline + 1)],
            ["right side │", fg(rightX(), baseline + 1)],
            ["bottom ╰", fg(x, y + height - 1)],
            ["bottom ─", fg(x + width - 2, y + height - 1)],
        ]);
    }

    function setTheme(theme: WorkbenchTheme): void {
        h.container.get(ThemeServiceDIToken).setTheme(theme);
        h.testApp.render();
    }

    it("the whole frame is panel.border even when the theme's tab.border differs (Monokai), and follows a theme switch", async () => {
        const monokai = WorkbenchTheme.fromThemeFile(monokaiTheme);
        expect(monokai.getRequiredColor("tab.border")).not.toBe(monokai.getRequiredColor("panel.border"));

        setTheme(monokai);
        for (const [line, color] of frameLineColors()) {
            expect(color, line).toBe(monokai.getRequiredColor("panel.border"));
        }

        // With title buttons the corner ╮ is the actions box's.
        await showButtons(true);
        for (const [line, color] of frameLineColors()) {
            expect(color, `${line}, with buttons`).toBe(monokai.getRequiredColor("panel.border"));
        }

        const other = WorkbenchTheme.fromThemeFile({
            name: "other",
            type: "dark",
            colors: { "panel.border": "#123456", "tab.border": "#000001" },
        });
        setTheme(other);
        for (const [line, color] of frameLineColors()) {
            expect(color, `${line}, after the switch`).toBe(0x123456);
        }
    });

    it("a theme without panel.border frames the group in the registry default, tab lines included", () => {
        const theme = WorkbenchTheme.fromThemeFile({ name: "bare", type: "dark", colors: { "tab.border": "#000001" } });

        setTheme(theme);

        for (const [line, color] of frameLineColors()) {
            expect(color, line).toBe(theme.getRequiredColor("panel.border"));
        }
    });
});
