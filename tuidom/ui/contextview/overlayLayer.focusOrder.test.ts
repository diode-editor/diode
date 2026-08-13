import { describe, expect, it } from "vitest";

import { TestApp } from "../../testing/TestApp.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import { InputElement } from "../inputbox/inputElement.ts";
import { BoxElement } from "../layout/boxElement.ts";

/**
 * Tab-обход и скрытые оверлеи. Оверлей-элементы остаются в дереве после
 * закрытия (сессию переиспользуют), поэтому без фильтра по видимости Tab уводил
 * фокус в невидимый инпут find-виджета или в закрытый QuickPick — курсор
 * пропадал, и дальнейший ввод уходил в никуда.
 */
function appWithOverlay() {
    const content = new BoxElement();
    content.focusable = true;
    const app = TestApp.createWithContent(content, new Size(40, 12));
    const hidden = new InputElement();
    hidden.focusable = true;
    const session = app.root.overlayLayer.createSession(hidden, new Point(1, 1), {
        pointerPolicy: "close-on-outside",
    });
    app.render();
    return { app, content, hidden, session };
}

describe("OverlayLayer: Tab-обход", () => {
    it("не отдаёт фокус элементу закрытой сессии", () => {
        const { app, content, hidden } = appWithOverlay();

        const order = app.root.getDepthFirstFocusableOrder();

        expect(order).toContain(content);
        expect(order).not.toContain(hidden);
    });

    it("открытая сессия в обход попадает", () => {
        const { app, hidden, session } = appWithOverlay();
        session.open();

        expect(app.root.getDepthFirstFocusableOrder()).toContain(hidden);
    });

    it("после закрытия элемент снова выпадает из обхода", () => {
        const { app, hidden, session } = appWithOverlay();
        session.open();
        expect(app.root.getDepthFirstFocusableOrder()).toContain(hidden);

        session.close();

        expect(app.root.getDepthFirstFocusableOrder()).not.toContain(hidden);
    });

    it("Tab не уводит фокус в невидимый оверлей", () => {
        // Пользовательский путь: единственный видимый фокусируемый — контент,
        // и Tab обязан остаться на нём, а не провалиться в скрытый инпут.
        const { app, content } = appWithOverlay();
        content.focus();

        app.sendKey("Tab");

        expect(app.focusedElement).toBe(content);
    });
});
