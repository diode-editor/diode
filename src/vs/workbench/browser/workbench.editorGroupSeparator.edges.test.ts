import { compositeOver } from "@tuidom/core/common/colorUtils";
import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { darkPlusTheme } from "../services/themes/common/themes/darkPlus.ts";
import { lightModernTheme } from "../services/themes/common/themes/lightModern.ts";
import { lightPlusTheme } from "../services/themes/common/themes/lightPlus.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import { EditorPartComponentDIToken } from "./parts/editor/editorPartComponent.ts";

function mouse(x: number, y: number, button: MouseToken["button"], action: MouseToken["action"]): MouseToken {
    return {
        kind: "mouse",
        button,
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

function findSashes(element: TUIElement): SashElement[] {
    const own = element instanceof SashElement ? [element] : [];
    return [...own, ...element.getChildren().flatMap(findSashes)];
}

describe("Workbench — editor group separator, edges", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
        h = undefined;
        ws = undefined;
    });

    /** Opens a.txt; `noSidebar` hides the sidebar so the editor part is the whole terminal width. */
    async function start(size: Size, noSidebar = false): Promise<IAppHarness> {
        ws = createTempWorkspace({ prefix: "diode-group-separator-edges-", files: { "a.txt": "alpha\nbeta\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.txt"), size });
        if (noSidebar) await h.commands.execute("workbench.action.toggleSidebarVisibility");
        h.testApp.render();
        return h;
    }

    async function run(command: string): Promise<void> {
        await h!.commands.execute(command);
        h!.testApp.render();
    }

    function part(): TUIElement {
        return h!.container.get(EditorPartComponentDIToken).view;
    }

    function groupCount(): number {
        return h!.container.get(EditorServiceDIToken).editorGroups.groups.length;
    }

    function groupSashes(): SashElement[] {
        return findSashes(part()).filter((s) => !s.hidden);
    }

    function groupViews(): TUIElement[] {
        return part()
            .getChildren()
            .filter((child) => !(child instanceof SashElement));
    }

    function drag(from: Point, to: Point): void {
        const backend = h!.testApp.backend;
        backend.simulateMouse(mouse(from.x, from.y, "left", "press"));
        h!.testApp.render();
        backend.simulateMouse(mouse(to.x, to.y, "left", "move"));
        h!.testApp.render();
        backend.simulateMouse(mouse(to.x, to.y, "left", "release"));
        h!.testApp.render();
    }

    function textAt(x: number, y: number): string {
        return h!.testApp.backend.getTextAt(new Point(x, y), 1);
    }

    describe("room for a split counts the separator cells", () => {
        it("41 columns hold two groups of 20 and a separator", async () => {
            await start(new Size(41, 20), true);
            expect(part().layoutSize.width).toBe(41);

            await run("workbench.action.splitEditor");

            expect(groupCount()).toBe(2);
            const [left, right] = groupViews();
            expect(left.layoutSize.width).toBe(20);
            expect(right.layoutSize.width).toBe(20);
            expect(textAt(20, part().globalPosition.y + 3)).toBe("│");
        });

        it("40 columns do not: the split is silently rejected", async () => {
            await start(new Size(40, 20), true);
            expect(part().layoutSize.width).toBe(40);

            await run("workbench.action.splitEditor");

            expect(groupCount()).toBe(1);
            expect(groupSashes()).toEqual([]);
        });

        it("three groups: 62 columns fit, the widths and separators add up to the part", async () => {
            await start(new Size(62, 20), true);
            await run("workbench.action.splitEditor");
            await run("workbench.action.focusFirstEditorGroup");
            await run("workbench.action.splitEditor");

            expect(groupCount()).toBe(3);
            const widths = groupViews().map((v) => v.layoutSize.width);
            expect(
                widths.every((w) => w >= 20),
                widths.join(","),
            ).toBe(true);
            expect(widths.reduce((a, b) => a + b, 0) + 2).toBe(62);
            const y = part().globalPosition.y + 3;
            for (const sash of groupSashes()) expect(textAt(sash.globalPosition.x, y)).toBe("│");
        });

        it("three groups: 61 columns do not fit the third", async () => {
            await start(new Size(61, 20), true);
            await run("workbench.action.splitEditor");
            await run("workbench.action.focusFirstEditorGroup");
            await run("workbench.action.splitEditor");

            expect(groupCount()).toBe(2);
        });

        it("rows: a stacked split needs 5 + 1 + 5 rows", async () => {
            await start(new Size(80, 30), true);
            await run("workbench.action.splitEditor");
            await run("workbench.action.toggleEditorGroupLayout");
            const [top, bottom] = groupViews();
            expect(top.layoutSize.height + bottom.layoutSize.height + 1).toBe(part().layoutSize.height);
        });
    });

    describe("dragging the separator", () => {
        it("rows: dragging the ─ row puts it under the cursor", async () => {
            await start(new Size(100, 30));
            await run("workbench.action.splitEditor");
            await run("workbench.action.toggleEditorGroupLayout");
            const [sash] = groupSashes();
            const from = new Point(part().globalPosition.x + 10, sash.globalPosition.y);
            const to = new Point(from.x, from.y - 3);

            drag(from, to);

            expect(groupSashes()[0].globalPosition.y).toBe(to.y);
            const [top, bottom] = groupViews();
            expect(top.globalPosition.y + top.layoutSize.height).toBe(to.y);
            expect(bottom.globalPosition.y).toBe(to.y + 1);
            expect(textAt(from.x, to.y)).toBe("─");
            expect(textAt(from.x, from.y)).not.toBe("─");
        });

        it("columns: dragging far left stops at the 20-column minimum of the left group", async () => {
            await start(new Size(100, 30), true);
            await run("workbench.action.splitEditor");
            const [sash] = groupSashes();
            const y = sash.globalPosition.y + 5;

            drag(new Point(sash.globalPosition.x, y), new Point(2, y));

            const [left, right] = groupViews();
            expect(left.layoutSize.width).toBe(20);
            expect(right.layoutSize.width).toBe(100 - 20 - 1);
            expect(textAt(20, y)).toBe("│");
        });

        it("columns: dragging far right stops at the 20-column minimum of the right group", async () => {
            await start(new Size(100, 30), true);
            await run("workbench.action.splitEditor");
            const [sash] = groupSashes();
            const y = sash.globalPosition.y + 5;

            drag(new Point(sash.globalPosition.x, y), new Point(98, y));

            const [left, right] = groupViews();
            expect(right.layoutSize.width).toBe(20);
            expect(left.layoutSize.width).toBe(100 - 20 - 1);
            expect(textAt(100 - 20 - 1, y)).toBe("│");
        });

        it("rows: dragging past either edge keeps both groups at 5 rows at least", async () => {
            await start(new Size(100, 30));
            await run("workbench.action.splitEditor");
            await run("workbench.action.toggleEditorGroupLayout");
            const x = part().globalPosition.x + 10;
            const height = part().layoutSize.height;

            drag(new Point(x, groupSashes()[0].globalPosition.y), new Point(x, part().globalPosition.y));
            expect(groupViews()[0].layoutSize.height).toBe(5);
            expect(groupViews()[1].layoutSize.height).toBe(height - 5 - 1);

            drag(new Point(x, groupSashes()[0].globalPosition.y), new Point(x, part().globalPosition.y + height - 1));
            expect(groupViews()[1].layoutSize.height).toBe(5);
            expect(groupViews()[0].layoutSize.height).toBe(height - 5 - 1);
        });
    });

    it("keyboard resize never squeezes the neighbor below 20 columns", async () => {
        await start(new Size(100, 30), true);
        await run("workbench.action.splitEditor");
        for (let i = 0; i < 30; i++) await run("workbench.action.increaseEditorWidth");

        const [left, right] = groupViews();
        expect(Math.min(left.layoutSize.width, right.layoutSize.width)).toBe(20);
        expect(left.layoutSize.width + right.layoutSize.width + 1).toBe(100);
    });

    it("closing the middle of three groups leaves one separator between the other two", async () => {
        await start(new Size(120, 30), true);
        await run("workbench.action.splitEditor");
        await run("workbench.action.splitEditor");
        expect(groupCount()).toBe(3);
        await run("workbench.action.focusSecondEditorGroup");
        await run("workbench.action.closeEditorsAndGroup");

        expect(groupCount()).toBe(2);
        expect(groupSashes()).toHaveLength(1);
        const [left, right] = groupViews();
        const x = groupSashes()[0].globalPosition.x;
        expect(left.layoutSize.width).toBe(x);
        expect(right.globalPosition.x).toBe(x + 1);
        expect(left.layoutSize.width + right.layoutSize.width + 1).toBe(120);
        const y = part().globalPosition.y + 3;
        const lines = [...Array(120).keys()].filter((cx) => textAt(cx, y) === "│");
        expect(lines).toEqual([x]);
    });

    it("a narrower window shrinks the groups, the separator stays one cell", async () => {
        const app = await start(new Size(100, 30), true);
        await run("workbench.action.splitEditor");

        app.testApp.backend.resize(new Size(70, 30));
        app.testApp.render();

        const [left, right] = groupViews();
        expect(left.layoutSize.width + right.layoutSize.width + 1).toBe(70);
        const x = groupSashes()[0].globalPosition.x;
        expect(right.globalPosition.x).toBe(x + 1);
        expect(textAt(x, part().globalPosition.y + 3)).toBe("│");
    });

    it.each([
        ["Light Modern", lightModernTheme, 0xe5e5e5],
        ["Dark+ (registry default)", darkPlusTheme, 0x444444],
        ["Light+ (registry default)", lightPlusTheme, 0xe7e7e7],
    ])("%s: the line is drawn in its editorGroup.border", async (_name, file, expected) => {
        await start(new Size(100, 30));
        h!.container.get(ThemeServiceDIToken).setTheme(WorkbenchTheme.fromThemeFile(file));
        await run("workbench.action.splitEditor");

        const theme = h!.container.get(ThemeServiceDIToken).theme;
        const bg = theme.getRequiredColor("editor.background");
        const cell = new Point(groupSashes()[0].globalPosition.x, part().globalPosition.y + 3);
        expect(textAt(cell.x, cell.y)).toBe("│");
        expect(h!.testApp.backend.getBgAt(cell)).toBe(bg);
        expect(h!.testApp.backend.getFgAt(cell) & 0xffffff).toBe(compositeOver(expected, bg) & 0xffffff);
    });

    it("the sidebar sash stays invisible at rest after a split", async () => {
        await start(new Size(100, 30));
        await run("workbench.action.splitEditor");

        const shellSashes = findSashes(h!.workbench.view).filter((s) => !s.hidden && !groupSashes().includes(s));
        expect(shellSashes.length).toBeGreaterThan(0);
        for (const sash of shellSashes) {
            const { x, y } = sash.globalPosition;
            const { width, height } = sash.layoutSize;
            // Sample the middle of the sash: a panel sash may share its row with panel.border.
            const cx = x + Math.floor(width / 2);
            const cy = y + Math.floor(height / 2);
            if (height > width) expect(textAt(cx, cy), `sash at ${x},${y}`).not.toBe("│");
        }
    });
});
