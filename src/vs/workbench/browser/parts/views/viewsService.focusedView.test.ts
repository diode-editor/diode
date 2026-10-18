import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const PANEL = "workbench.panel.output";

/** Контейнер панели с двумя секциями внутри окна (BodyElement) с overlay-слоем. */
function scene() {
    const h = makeViewsHarness();
    const first = testView("first", PANEL, 10);
    const second = testView("second", PANEL, 20, { body: null, placeholder: "nothing yet" });
    h.service.registerContainer({ id: PANEL, title: "OUTPUT", location: "panel" });
    h.service.registerView(first);
    h.service.registerView(second);
    h.service.attachContainer(PANEL);
    const body = new BodyElement();
    body.setContent(h.root(PANEL));
    const popup = new TUIElement();
    body.getOverlayLayer().addItem(popup, new Point(0, 0));
    const keys = new ContextKeyService();
    return { h, first: first.body!, popup, keys, body };
}

describe("ViewsService — вид с фокусом (focusedView)", () => {
    it("фокус в теле секции — её id", () => {
        const { h, first } = scene();
        expect(h.service.getFocusedViewId(first)).toBe("first");
    });

    it("фокус в пустом состоянии секции — тоже её id", () => {
        const { h } = scene();
        const placeholder = h.paneView(PANEL).querySelector("#viewPlaceholder-second")!;
        expect(h.service.getFocusedViewId(placeholder)).toBe("second");
    });

    it("фокус вне видов и без фокуса — null", () => {
        const { h, body } = scene();
        expect(h.service.getFocusedViewId(body)).toBeNull();
        expect(h.service.getFocusedViewId(null)).toBeNull();
        expect(h.service.getFocusedViewId(new TUIElement())).toBeNull();
    });

    it("ключ: вид → его id; уход в другую часть окна — пусто", () => {
        const { h, first, body, keys } = scene();
        h.service.updateContextKeys(keys, first);
        expect(keys.get("focusedView")).toBe("first");
        h.service.updateContextKeys(keys, body);
        expect(keys.get("focusedView")).toBe("");
    });

    it("фокус в оверлее (палитра) и промежуточный null ключ не сбрасывают", () => {
        const { h, first, popup, keys } = scene();
        h.service.updateContextKeys(keys, first);
        h.service.updateContextKeys(keys, null);
        expect(keys.get("focusedView")).toBe("first");
        h.service.updateContextKeys(keys, popup);
        expect(keys.get("focusedView")).toBe("first");
    });
});
