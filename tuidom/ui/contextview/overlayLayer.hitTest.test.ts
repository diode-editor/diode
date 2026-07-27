import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { BoxElement } from "../layout/boxElement.ts";
import { PopupMenuElement } from "../menu/popupMenuElement.ts";

import { OverlayLayer } from "./overlayLayer.ts";

function sizedBox(global: Point, size: Size): BoxElement {
    const box = new BoxElement();
    box.localPosition = new Offset(global.x, global.y);
    box.performLayout(BoxConstraints.tight(size));
    return box;
}

describe("OverlayLayer — elementFromPoint", () => {
    it("returns the visible element under the point", () => {
        const layer = new OverlayLayer();
        const hidden = sizedBox(new Point(0, 0), new Size(4, 3));
        const visible = sizedBox(new Point(5, 2), new Size(6, 4));

        layer.addItem(hidden, new Point(0, 0), false);
        layer.addItem(visible, new Point(5, 2), true);

        // Inside the visible box (top-most item is tested first).
        expect(layer.elementFromPoint(new Point(6, 3))).toBe(visible);
    });

    it("skips invisible items and returns null when nothing visible is hit", () => {
        const layer = new OverlayLayer();
        const visible = sizedBox(new Point(5, 2), new Size(6, 4));
        const hidden = sizedBox(new Point(0, 0), new Size(4, 3));

        layer.addItem(visible, new Point(5, 2), true);
        layer.addItem(hidden, new Point(0, 0), false);

        // (1, 1) lies over the hidden box but outside the visible one: the hidden
        // item is skipped and the miss falls through to null.
        expect(layer.elementFromPoint(new Point(1, 1))).toBeNull();
    });
});

describe("OverlayLayer — openPopupSession", () => {
    it("opens a session positioned by the anchor", () => {
        const layer = new OverlayLayer();
        layer.localPosition = new Offset(0, 0);
        layer.performLayout(BoxConstraints.tight(new Size(40, 20)));

        const menu = new PopupMenuElement([{ label: "Copy" }]);
        const anchor = { screenX: 3, screenY: 1 };
        const handle = layer.openPopupSession(menu, anchor, { visible: true, pointerPolicy: "passthrough" });

        expect(handle.isOpen()).toBe(true);

        const expected = layer.computeAnchorPosition(menu, anchor);
        const item = layer.getItems().find((entry) => entry.element === menu);
        expect(item?.position).toEqual(expected);
    });
});
