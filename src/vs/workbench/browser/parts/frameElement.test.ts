import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../../TestUtils/expectScreen.ts";
import { renderElement } from "../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../TestUtils/TestApp.ts";

import type { IFrameJointSource } from "./frameElement.ts";
import { FrameElement } from "./frameElement.ts";

/** A part whose separators sit on the given rows (it draws nothing itself). */
class SectionsElement extends TUIElement implements IFrameJointSource {
    public constructor(private rows: number[]) {
        super();
    }

    public setRows(rows: number[]): void {
        this.rows = rows;
        this.markDirty();
    }

    public getFrameJointRows(): readonly number[] {
        return this.rows;
    }
}

function textRows(backend: ReturnType<typeof renderElement>, width: number, height: number): string[] {
    return Array.from({ length: height }, (_, y) => backend.getTextAt(new Point(0, y), width));
}

describe("FrameElement", () => {
    it("draws a rounded frame and lays the part inside it", () => {
        const part = new TUIElement();
        const frame = new FrameElement(part);

        const backend = renderElement(frame, 6, 4, { themeVars: true });

        expectScreen(
            backend,
            screen`
                ╭────╮
                │    │
                │    │
                ╰────╯
            `,
        );
        expect(part.localPosition.dx).toBe(1);
        expect(part.localPosition.dy).toBe(1);
        expect(part.layoutSize).toEqual(new Size(4, 2));
    });

    it("leaves the top to the tabs above with openTop and starts the part at the first row", () => {
        const part = new TUIElement();
        const frame = new FrameElement(part);
        frame.openTop = true;

        const backend = renderElement(frame, 6, 3, { themeVars: true });

        expect(textRows(backend, 6, 3)).toEqual(["│    │", "│    │", "╰────╯"]);
        expect(part.localPosition.dy).toBe(0);
        expect(part.layoutSize).toEqual(new Size(4, 2));
    });

    it("lies on the part's background", () => {
        const part = new TUIElement();
        part.style = { bg: "sideBar.background" };
        const frame = new FrameElement(part);
        frame.style = { bg: "editor.background" };

        const backend = renderElement(frame, 6, 4, { themeVars: true });

        expect(backend.getBgAt(new Point(0, 0))).toBe(backend.getBgAt(new Point(2, 2)));
        expect(backend.getBgAt(new Point(5, 3))).toBe(backend.getBgAt(new Point(2, 2)));
    });

    it("meets the part's separators with joints", () => {
        const frame = new FrameElement(new SectionsElement([1]));

        const backend = renderElement(frame, 6, 5, { themeVars: true });

        expect(textRows(backend, 6, 5)).toEqual(["╭────╮", "│    │", "├    ┤", "│    │", "╰────╯"]);
        expect(frame.getJointRows()).toEqual([2]);
    });

    it("drops a joint that falls on its own bottom line", () => {
        const frame = new FrameElement(new SectionsElement([0, 3]));
        frame.layout(BoxConstraints.tight(new Size(6, 5)));

        expect(frame.getJointRows()).toEqual([1]);
    });

    it("repaints its joints when only the part re-laid out", () => {
        const sections = new SectionsElement([0]);
        const app = TestApp.createWithContent(new FrameElement(sections), new Size(6, 6));
        app.render();
        expect(app.backend.getTextAt(new Point(0, 1), 6)).toBe("├    ┤");

        sections.setRows([2]);
        app.render();

        expect(app.backend.getTextAt(new Point(0, 1), 6)).toBe("│    │");
        expect(app.backend.getTextAt(new Point(0, 3), 6)).toBe("├    ┤");
    });

    it("swaps its part", () => {
        const first = new TUIElement();
        const second = new TUIElement();
        const frame = new FrameElement(first);

        frame.setChild(second);

        expect(frame.getChild()).toBe(second);
        expect(frame.getChildren()).toEqual([second]);
        expect(first.getParent()).toBeNull();
    });
});
