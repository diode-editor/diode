import { describe, expect, it } from "vitest";

import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Point, Size } from "../../common/geometryPromitives.ts";
import type { MouseToken } from "../../input/rawTerminalToken.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement } from "./listViewElement.ts";

const ACTIVE_BG = packRgb(4, 57, 94);
const ACTIVE_FG = packRgb(255, 255, 255);
const INACTIVE_BG = packRgb(55, 55, 61);
const INACTIVE_FG = packRgb(204, 204, 204);
const HOVER_BG = packRgb(42, 45, 46);

function makeRow(id: string, text = id): TextLabelElement {
    const row = new TextLabelElement(text);
    row.id = id;
    return row;
}

// Цвета — из палитры dark+, которую TestApp кладёт в корневой var-scope;
// значения совпадают с дефолтами реестра (см. STYLE_TOKEN_DEFAULTS).
function createList(size = new Size(20, 5)): { list: ListViewElement; app: TestApp } {
    const list = new ListViewElement();
    list.appendRow(makeRow("a", "Alpha"));
    list.appendRow(makeRow("b", "Beta"));
    list.appendRow(makeRow("c", "Gamma"));
    const app = TestApp.createWithContent(list, size);
    return { list, app };
}

function makeMouseToken(overrides: Partial<MouseToken> & { action: MouseToken["action"] }): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: 1,
        y: 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
        ...overrides,
    };
}

describe("ListViewElement styling", () => {
    it("uses activeSelection colors for the cursor row when focused", () => {
        const { list, app } = createList();
        list.focus();
        app.render();

        expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
        expect(app.backend.getFgAt(new Point(0, 0))).toBe(ACTIVE_FG);
        // Не-курсорная строка остаётся обычной.
        expect(app.backend.getBgAt(new Point(0, 1))).not.toBe(ACTIVE_BG);
    });

    it("uses inactiveSelection colors when the list is blurred", () => {
        const { list, app } = createList();
        list.focus();
        app.render();
        list.blur();
        app.render();

        expect(app.backend.getBgAt(new Point(0, 0))).toBe(INACTIVE_BG);
        expect(app.backend.getFgAt(new Point(0, 0))).toBe(INACTIVE_FG);
    });

    it("switches back to active colors when focus is regained", () => {
        const { list, app } = createList();
        app.render();
        expect(app.backend.getBgAt(new Point(0, 0))).toBe(INACTIVE_BG);

        list.focus();
        app.render();
        expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
    });

    it("hover красит фон строки, fg остаётся обычным", () => {
        const { app } = createList();
        const normalFg = app.backend.getFgAt(new Point(0, 1));
        app.backend.simulateMouse(makeMouseToken({ action: "move", x: 3, y: 2 }));
        app.render();

        expect(app.backend.getBgAt(new Point(0, 1))).toBe(HOVER_BG);
        expect(app.backend.getFgAt(new Point(0, 1))).toBe(normalFg);
    });

    it("cursor row takes priority over hover", () => {
        const { list, app } = createList();
        list.focus();
        app.backend.simulateMouse(makeMouseToken({ action: "move", x: 3, y: 1 }));
        app.render();

        expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
    });

    it("clears hover on mouseleave", () => {
        const { app } = createList();
        app.backend.simulateMouse(makeMouseToken({ action: "move", x: 3, y: 2 }));
        app.render();
        expect(app.backend.getBgAt(new Point(0, 1))).toBe(HOVER_BG);

        // Уводим мышь ниже контента — hover гаснет.
        app.backend.simulateMouse(makeMouseToken({ action: "move", x: 3, y: 5 }));
        app.render();
        expect(app.backend.getBgAt(new Point(0, 1))).not.toBe(HOVER_BG);
    });

    it("multi-selected rows share the selection colors", () => {
        const { list, app } = createList();
        list.focus();
        app.sendKey("Shift+ArrowDown");
        app.render();

        expect(app.backend.getBgAt(new Point(0, 0))).toBe(ACTIVE_BG);
        expect(app.backend.getBgAt(new Point(0, 1))).toBe(ACTIVE_BG);
        expect(app.backend.getBgAt(new Point(0, 2))).not.toBe(ACTIVE_BG);
    });
});
