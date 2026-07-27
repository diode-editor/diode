import { describe, expect, it } from "vitest";

import { expectScreen, screen } from "../../../src/TestUtils/expectScreen.ts";
import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { RenderContext } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";
import { BoxElement } from "../layout/boxElement.ts";
import { VStackElement } from "../layout/vStackElement.ts";
import { MenuBarElement } from "../menu/menuBarElement.ts";
import { StatusBarElement } from "../statusbar/statusBarElement.ts";

import { BodyElement } from "./bodyElement.ts";

describe("BodyElement root reference", () => {
    it("BodyElement initializes root pointing to itself", () => {
        const body = new BodyElement();
        expect(body.getRoot()).toBe(body);
    });

    it("content element receives root reference from BodyElement", () => {
        const body = new BodyElement();
        const content = new BoxElement();

        body.setContent(content);

        expect(content.getRoot()).toBe(body);
    });

    it("OverlayLayer receives root reference from BodyElement", () => {
        const body = new BodyElement();

        expect(body.overlayLayer.getRoot()).toBe(body);
    });

    it("nested elements in VStack all receive the same root", () => {
        const body = new BodyElement();
        const vstack = new VStackElement();
        const box1 = new BoxElement();
        const box2 = new BoxElement();

        body.setContent(vstack);
        vstack.addChild(box1, { width: "fill", height: 5 });
        vstack.addChild(box2, { width: "fill", height: 5 });

        expect(vstack.getRoot()).toBe(body);
        expect(box1.getRoot()).toBe(body);
        expect(box2.getRoot()).toBe(body);
    });

    it("items added to OverlayLayer receive root reference", () => {
        const body = new BodyElement();
        const popup = new BoxElement();

        body.overlayLayer.addItem(popup, new Point(5, 5), true);

        expect(popup.getRoot()).toBe(body);
    });

    it("multiple nested VStacks preserve root reference throughout hierarchy", () => {
        const body = new BodyElement();
        const vstack1 = new VStackElement();
        const vstack2 = new VStackElement();
        const leaf = new BoxElement();

        body.setContent(vstack1);
        vstack1.addChild(vstack2, { width: "fill", height: 10 });
        vstack2.addChild(leaf, { width: "fill", height: 5 });

        expect(vstack1.getRoot()).toBe(body);
        expect(vstack2.getRoot()).toBe(body);
        expect(leaf.getRoot()).toBe(body);
    });
});

describe("BodyElement menuBar integration", () => {
    function layoutBody(body: BodyElement, width = 40, height = 20): void {
        body.localPosition = new Offset(0, 0);
        body.performLayout(BoxConstraints.tight(new Size(width, height)));
    }

    it("menuBar receives root reference from BodyElement", () => {
        const body = new BodyElement();
        const menuBar = new MenuBarElement([{ label: "File", entries: [] }]);

        body.setMenuBar(menuBar);

        expect(menuBar.getRoot()).toBe(body);
    });

    it("content positioned at y=1 when menuBar is set", () => {
        const body = new BodyElement();
        const menuBar = new MenuBarElement([{ label: "File", entries: [] }]);
        const content = new BoxElement();

        body.setMenuBar(menuBar);
        body.setContent(content);
        layoutBody(body);

        expect(content.localPosition.dy).toBe(1);
        expect(content.globalPosition.y).toBe(1);
    });

    it("content height reduced by 1 when menuBar is set", () => {
        const body = new BodyElement();
        const menuBar = new MenuBarElement([{ label: "File", entries: [] }]);
        const content = new BoxElement();

        body.setMenuBar(menuBar);
        body.setContent(content);
        layoutBody(body, 40, 20);

        expect(content.layoutSize.width).toBe(40);
        expect(content.layoutSize.height).toBe(19);
    });

    it("content at y=0 and full height without menuBar", () => {
        const body = new BodyElement();
        const content = new BoxElement();

        body.setContent(content);
        layoutBody(body, 40, 20);

        expect(content.localPosition.dy).toBe(0);
        expect(content.globalPosition.y).toBe(0);
        expect(content.layoutSize.height).toBe(20);
    });

    it("menuBar receives full body size for layout", () => {
        const body = new BodyElement();
        const menuBar = new MenuBarElement([{ label: "File", entries: [] }]);

        body.setMenuBar(menuBar);
        layoutBody(body, 40, 20);

        expect(menuBar.layoutSize.width).toBe(40);
        expect(menuBar.layoutSize.height).toBe(20);
    });
});

describe("BodyElement statusBar integration", () => {
    function layoutBody(body: BodyElement, width = 40, height = 20): void {
        body.localPosition = new Offset(0, 0);
        body.performLayout(BoxConstraints.tight(new Size(width, height)));
    }

    it("statusBar receives root reference from BodyElement", () => {
        const body = new BodyElement();
        const statusBar = new StatusBarElement();

        body.setStatusBar(statusBar);

        expect(statusBar.getRoot()).toBe(body);
    });

    it("statusBar positioned at bottom row", () => {
        const body = new BodyElement();
        const statusBar = new StatusBarElement();

        body.setStatusBar(statusBar);
        layoutBody(body, 40, 20);

        expect(statusBar.localPosition.dy).toBe(19);
        expect(statusBar.globalPosition.y).toBe(19);
    });

    it("content height reduced by 1 when statusBar is set", () => {
        const body = new BodyElement();
        const statusBar = new StatusBarElement();
        const content = new BoxElement();

        body.setStatusBar(statusBar);
        body.setContent(content);
        layoutBody(body, 40, 20);

        expect(content.layoutSize.width).toBe(40);
        expect(content.layoutSize.height).toBe(19);
    });

    it("content height reduced by 2 with both menuBar and statusBar", () => {
        const body = new BodyElement();
        const menuBar = new MenuBarElement([{ label: "File", entries: [] }]);
        const statusBar = new StatusBarElement();
        const content = new BoxElement();

        body.setMenuBar(menuBar);
        body.setStatusBar(statusBar);
        body.setContent(content);
        layoutBody(body, 40, 20);

        expect(content.localPosition.dy).toBe(1);
        expect(content.layoutSize.height).toBe(18);
        expect(statusBar.localPosition.dy).toBe(19);
    });

    it("statusBar included in getChildren", () => {
        const body = new BodyElement();
        const statusBar = new StatusBarElement();

        body.setStatusBar(statusBar);

        const children = body.getChildren();
        expect(children).toContain(statusBar);
    });

    it("statusBar has full width", () => {
        const body = new BodyElement();
        const statusBar = new StatusBarElement();

        body.setStatusBar(statusBar);
        layoutBody(body, 40, 20);

        expect(statusBar.layoutSize.width).toBe(40);
        expect(statusBar.layoutSize.height).toBe(1);
    });
});
