import { describe, expect, it } from "vitest";

import { BodyElement } from "../ui/body/bodyElement.ts";
import { EditorGroupElement } from "../ui/editorgroup/editorGroupElement.ts";
import { BoxElement } from "../ui/layout/boxElement.ts";

import { TUIElement } from "./tuiElement.ts";

class ContainerElement extends TUIElement {
    public addChild(child: TUIElement): void {
        this.appendChild(child);
    }
}

describe("TUIElement.getOverlayLayer — ближайший overlay-слой вверх по дереву", () => {
    it("returns null for a detached element", () => {
        expect(new TUIElement().getOverlayLayer()).toBeNull();
    });

    it("returns null when no ancestor hosts a layer", () => {
        const parent = new ContainerElement();
        const child = new TUIElement();
        parent.addChild(child);

        expect(child.getOverlayLayer()).toBeNull();
    });

    it("finds the BodyElement layer from nested content", () => {
        const body = new BodyElement();
        const box = new ContainerElement();
        body.setContent(box);
        const leaf = new TUIElement();
        box.addChild(leaf);

        expect(leaf.getOverlayLayer()).toBe(body.overlayLayer);
        expect(body.getOverlayLayer()).toBe(body.overlayLayer);
    });

    it("EditorGroupElement's docked-widget layer is not exposed — popups go to the body layer", () => {
        // Слой группы живёт в её локальных координатах и клипует к её границам —
        // он для докнутых виджетов (find), а не для попапов из содержимого.
        const body = new BodyElement();
        const group = new EditorGroupElement();
        body.setContent(group);
        const leaf = new TUIElement();
        group.setContent(leaf);

        expect(leaf.getOverlayLayer()).toBe(body.overlayLayer);
        expect(group.getOverlayLayer()).toBe(body.overlayLayer);
    });
});
