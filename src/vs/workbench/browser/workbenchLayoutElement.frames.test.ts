import { BoxConstraints, Offset, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../TestUtils/renderElement.ts";

import { FrameElement } from "./parts/frameElement.ts";
import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

const WIDTH = 100;
const HEIGHT = 24;
const LEFT = 20;
const RIGHT = 25;
const BOTTOM = 8;
const CENTER_WIDTH = WIDTH - LEFT - RIGHT;
const CENTER_HEIGHT = HEIGHT - BOTTOM;

interface IScene {
    readonly layout: WorkbenchLayoutElement;
    readonly left: TUIElement;
    readonly center: TUIElement;
    readonly bottom: TUIElement;
    readonly right: TUIElement;
}

function scene(): IScene {
    const layout = new WorkbenchLayoutElement();
    const left = new TUIElement();
    const center = new TUIElement();
    const bottom = new TUIElement();
    const right = new TUIElement();
    layout.setLeftPanel(left);
    layout.setCenterContent(center);
    layout.setBottomPanel(bottom);
    layout.setRightPanel(right);
    layout.setLeftPanelWidth(LEFT);
    layout.setRightPanelWidth(RIGHT);
    layout.setBottomPanelHeight(BOTTOM);
    layout.setBottomPanelVisible(true);
    layout.setRightPanelVisible(true);
    layout.localPosition = new Offset(0, 0);
    layout.layout(BoxConstraints.tight(new Size(WIDTH, HEIGHT)));
    return { layout, left, center, bottom, right };
}

/** Sash order among the layout's children: left, right, bottom. */
function sashes(layout: WorkbenchLayoutElement): { left: SashElement; right: SashElement; bottom: SashElement } {
    const [left, right, bottom] = layout.getChildren().filter((c) => c instanceof SashElement);
    return { left, right, bottom };
}

function frameOf(part: TUIElement): FrameElement {
    const frame = part.getParent();
    expect(frame).toBeInstanceOf(FrameElement);
    return frame as FrameElement;
}

/** Press the sash at `grab` (a cell of it, in its own coordinates), then move that cell by `delta`. */
function drag(sash: SashElement, grab: number, delta: number): void {
    const vertical = sash.pointerShape === "ew-resize";
    const start = vertical ? sash.globalPosition.x + grab : sash.globalPosition.y + grab;
    const at = (screen: number) =>
        vertical
            ? { screenX: screen, screenY: sash.globalPosition.y, localX: screen - sash.globalPosition.x, localY: 0 }
            : { screenX: sash.globalPosition.x, screenY: screen, localX: 0, localY: screen - sash.globalPosition.y };
    sash.dispatchEvent(new TUIMouseEvent("mousedown", { button: "left", ...at(start) }));
    sash.dispatchEvent(new TUIMouseEvent("mousemove", { button: "left", ...at(start + delta) }));
    sash.dispatchEvent(new TUIMouseEvent("mouseup", { button: "left", ...at(start + delta) }));
}

describe("WorkbenchLayoutElement: part frames", () => {
    it("the side bar, the panel and the secondary side bar are children through frames; the center is not framed", () => {
        const { layout, left, center, bottom, right } = scene();
        const children = layout.getChildren();

        for (const part of [left, bottom, right]) {
            expect(children).toContain(frameOf(part));
            expect(children).not.toContain(part);
            expect(frameOf(part).getChild()).toBe(part);
            expect(frameOf(part).openTop).toBe(false);
        }
        // Editor groups frame themselves: the layout puts the center in as it is.
        expect(center.getParent()).toBe(layout);
        expect(children).toContain(center);
        // The layout's accessors still give the parts, not their frames.
        expect(layout.getLeftPanel()).toBe(left);
        expect(layout.getBottomPanel()).toBe(bottom);
        expect(layout.getRightPanel()).toBe(right);
    });

    it("each frame takes the part's slot; the part sits at (+1,+1) inside it, 2 smaller each way", () => {
        const { left, center, bottom, right } = scene();
        const slots: [TUIElement, Point, Size][] = [
            [left, new Point(0, 0), new Size(LEFT, HEIGHT)],
            [bottom, new Point(LEFT, CENTER_HEIGHT), new Size(CENTER_WIDTH, BOTTOM)],
            [right, new Point(LEFT + CENTER_WIDTH, 0), new Size(RIGHT, HEIGHT)],
        ];
        for (const [part, origin, size] of slots) {
            expect(frameOf(part).globalPosition).toEqual(origin);
            expect(frameOf(part).layoutSize).toEqual(size);
            expect(part.globalPosition).toEqual(new Point(origin.x + 1, origin.y + 1));
            expect(part.layoutSize).toEqual(new Size(size.width - 2, size.height - 2));
        }
        expect(center.globalPosition).toEqual(new Point(LEFT, 0));
        expect(center.layoutSize).toEqual(new Size(CENTER_WIDTH, CENTER_HEIGHT));
    });

    it("draws the frames' rounded corners at the slots' corners", () => {
        const { layout } = scene();
        const backend = renderElement(layout, WIDTH, HEIGHT, { themeVars: true });
        const char = (x: number, y: number) => backend.getTextAt(new Point(x, y), 1);

        expect([char(0, 0), char(LEFT - 1, 0), char(0, HEIGHT - 1), char(LEFT - 1, HEIGHT - 1)]).toEqual([
            "╭",
            "╮",
            "╰",
            "╯",
        ]);
        const rightX = LEFT + CENTER_WIDTH;
        expect([char(rightX, 0), char(WIDTH - 1, 0), char(rightX, HEIGHT - 1), char(WIDTH - 1, HEIGHT - 1)]).toEqual([
            "╭",
            "╮",
            "╰",
            "╯",
        ]);
        expect([char(LEFT, CENTER_HEIGHT), char(rightX - 1, CENTER_HEIGHT), char(LEFT, HEIGHT - 1)]).toEqual([
            "╭",
            "╮",
            "╰",
        ]);
    });

    it("a hidden part hides its frame too", () => {
        const { layout, left, bottom, right } = scene();
        layout.setLeftPanelVisible(false);
        layout.setBottomPanelVisible(false);
        layout.setRightPanelVisible(false);
        for (const part of [left, bottom, right]) {
            expect(part.hidden).toBe(true);
            expect(frameOf(part).hidden).toBe(true);
        }
        layout.setLeftPanelVisible(true);
        expect(frameOf(left).hidden).toBe(false);
    });

    it("the layout's own background is the surface beside the tabs: editorGroupHeader.tabsBackground", () => {
        expect(new WorkbenchLayoutElement().style.bg).toBe("editorGroupHeader.tabsBackground");
    });

    describe("sashes span both frame lines at a boundary", () => {
        it("the left sash: the side bar frame's last column and the editor's first, full height", () => {
            const { layout } = scene();
            const { left } = sashes(layout);
            expect(left.globalPosition).toEqual(new Point(LEFT - 1, 0));
            expect(left.layoutSize).toEqual(new Size(2, HEIGHT));
        });

        it("the right sash: the editor's last column and the secondary side bar frame's first, full height", () => {
            const { layout, right } = scene();
            const sash = sashes(layout).right;
            expect(sash.globalPosition).toEqual(new Point(frameOf(right).globalPosition.x - 1, 0));
            expect(sash.globalPosition).toEqual(new Point(LEFT + CENTER_WIDTH - 1, 0));
            expect(sash.layoutSize).toEqual(new Size(2, HEIGHT));
        });

        it("the bottom sash: the editor's last row and the panel frame's first, at the center width", () => {
            const { layout, bottom } = scene();
            const sash = sashes(layout).bottom;
            expect(sash.globalPosition).toEqual(new Point(LEFT, frameOf(bottom).globalPosition.y - 1));
            expect(sash.globalPosition).toEqual(new Point(LEFT, CENTER_HEIGHT - 1));
            expect(sash.layoutSize).toEqual(new Size(CENTER_WIDTH, 2));
        });
    });

    describe("dragging either cell of a sash moves the boundary the same", () => {
        it("the left sash", () => {
            for (const grab of [0, 1]) {
                const { layout } = scene();
                drag(sashes(layout).left, grab, 5);
                expect(layout.getLeftPanelWidth()).toBe(LEFT + 5);
            }
        });

        it("the left sash: pressing either cell without moving keeps the width", () => {
            for (const grab of [0, 1]) {
                const { layout } = scene();
                drag(sashes(layout).left, grab, 0);
                expect(layout.getLeftPanelWidth()).toBe(LEFT);
            }
        });

        it("the right sash", () => {
            for (const grab of [0, 1]) {
                const { layout } = scene();
                drag(sashes(layout).right, grab, -4);
                expect(layout.getRightPanelWidth()).toBe(RIGHT + 4);
            }
            for (const grab of [0, 1]) {
                const { layout } = scene();
                drag(sashes(layout).right, grab, 0);
                expect(layout.getRightPanelWidth()).toBe(RIGHT);
            }
        });

        it("the bottom sash", () => {
            for (const grab of [0, 1]) {
                const { layout } = scene();
                drag(sashes(layout).bottom, grab, -3);
                expect(layout.getBottomPanelHeight()).toBe(BOTTOM + 3);
            }
            for (const grab of [0, 1]) {
                const { layout } = scene();
                drag(sashes(layout).bottom, grab, 0);
                expect(layout.getBottomPanelHeight()).toBe(BOTTOM);
            }
        });
    });

    describe("no hover line on the sashes: the frame lines show the boundary", () => {
        it("every sash has no hover colour and keeps the resize pointer shape", () => {
            const { layout } = scene();
            const { left, right, bottom } = sashes(layout);
            for (const sash of [left, right, bottom]) expect(sash.hoverColorVar).toBeNull();
            expect(left.pointerShape).toBe("ew-resize");
            expect(right.pointerShape).toBe("ew-resize");
            expect(bottom.pointerShape).toBe("ns-resize");
        });

        it("hovering or dragging a sash leaves the frame lines on screen as they were", () => {
            const { layout } = scene();
            layout.setSashHoverDelay(0);
            const before = renderElement(layout, WIDTH, HEIGHT, { themeVars: true }).screenToString();
            for (const sash of Object.values(sashes(layout))) {
                const at = { screenX: sash.globalPosition.x, screenY: sash.globalPosition.y, localX: 0, localY: 0 };
                sash.dispatchEvent(new TUIMouseEvent("mouseenter", { button: "none", ...at }));
                expect(renderElement(layout, WIDTH, HEIGHT, { themeVars: true }).screenToString()).toBe(before);
                // A press with no move lights a classic sash for the drag; this one stays dark.
                sash.dispatchEvent(new TUIMouseEvent("mousedown", { button: "left", ...at }));
                expect(renderElement(layout, WIDTH, HEIGHT, { themeVars: true }).screenToString()).toBe(before);
                sash.dispatchEvent(new TUIMouseEvent("mouseup", { button: "left", ...at }));
                sash.dispatchEvent(new TUIMouseEvent("mouseleave", { button: "none", ...at }));
            }
        });
    });
});
