import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { Size } from "../../common/geometryPromitives.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";

import type { ISelectData } from "./selectBoxElement.ts";
import { SelectBoxElement } from "./selectBoxElement.ts";

const CHEVRON = "⌄";
const CHECK = "✓";

/** SelectBox внутри настоящей BodyElement: список живёт в её overlay-слое. */
function mount(options: readonly string[], selected = 0) {
    const select = new SelectBoxElement();
    select.setOptions(
        options.map((text) => ({ text })),
        selected,
    );
    const app = TestApp.createWithContent(select, new Size(60, 20));
    app.render();
    return { select, app };
}

function screenText(app: TestApp): string {
    app.render();
    return app.backend.screenToString();
}

describe("SelectBoxElement: закрытое состояние", () => {
    it("рисует выбранную опцию и шеврон", () => {
        const { select, app } = mount(["bootstrap", "configuration"]);

        const text = screenText(app);

        expect(text).toContain("bootstrap");
        expect(text).toContain(CHEVRON);
        expect(select.isOpen()).toBe(false);
    });

    it("ширина держится по самой длинной опции — не прыгает при смене выбора", () => {
        const { select } = mount(["a", "configuration"]);
        const width = select.getMaxIntrinsicWidth(1);

        select.select(1);

        expect(select.getMaxIntrinsicWidth(1)).toBe(width);
    });

    it("без выбора рисует пустой текст, а не падает", () => {
        const select = new SelectBoxElement();
        select.setOptions([{ text: "a" }]);
        const app = TestApp.createWithContent(select, new Size(20, 5));

        expect(() => {
            app.render();
        }).not.toThrow();
        expect(select.getSelected()).toBe(-1);
    });

    it("select с индексом вне списка игнорируется", () => {
        const { select } = mount(["a", "b"]);
        select.select(9);
        expect(select.getSelected()).toBe(0);
    });

    it("сжавшийся список подтягивает выбранный индекс", () => {
        // Канал мог исчезнуть — индекс не должен указывать в пустоту.
        const { select } = mount(["a", "b", "c"], 2);

        select.setOptions([{ text: "a" }]);

        expect(select.getSelected()).toBe(0);
    });
});

describe("SelectBoxElement: раскрытие", () => {
    it("Enter раскрывает список со всеми опциями", () => {
        const { select, app } = mount(["bootstrap", "configuration"]);
        select.focus();

        app.sendKey("Enter");

        expect(select.isOpen()).toBe(true);
        expect(screenText(app)).toContain("configuration");
    });

    it("ArrowDown тоже раскрывает — как у нативного select", () => {
        const { select, app } = mount(["a", "b"]);
        select.focus();

        app.sendKey("ArrowDown");

        expect(select.isOpen()).toBe(true);
    });

    it("активный пункт помечен галочкой", () => {
        const { select, app } = mount(["a", "b"], 1);
        select.focus();

        app.sendKey("Enter");

        expect(screenText(app)).toContain(CHECK);
    });

    it("Escape закрывает список", () => {
        const { select, app } = mount(["a", "b"]);
        select.focus();
        app.sendKey("Enter");
        expect(select.isOpen()).toBe(true);

        app.sendKey("Escape");

        expect(select.isOpen()).toBe(false);
    });

    it("повторное нажатие закрывает уже открытый список", () => {
        const { select, app } = mount(["a", "b"]);
        select.focus();
        app.sendKey("Enter");

        app.sendKey("Enter");

        expect(select.isOpen()).toBe(false);
    });

    it("пустой список не раскрывается", () => {
        const select = new SelectBoxElement();
        const app = TestApp.createWithContent(select, new Size(20, 5));
        app.render();
        select.focus();

        app.sendKey("Enter");

        expect(select.isOpen()).toBe(false);
    });
});

describe("SelectBoxElement: выбор", () => {
    it("выбор пункта закрывает список, меняет текст и файрит onDidSelect", () => {
        const { select, app } = mount(["bootstrap", "configuration"]);
        const seen: ISelectData[] = [];
        select.onDidSelect = (data) => seen.push(data);
        select.focus();
        app.sendKey("Enter");

        app.sendKey("ArrowDown");
        app.sendKey("Enter");

        expect(seen).toEqual([{ selected: "configuration", index: 1 }]);
        expect(select.getSelected()).toBe(1);
        expect(select.isOpen()).toBe(false);
        expect(screenText(app)).toContain("configuration");
    });

    it("программный select не файрит onDidSelect", () => {
        // Разделение из vscode: `select()` — синхронизация состояния, а событие
        // означает «пользователь выбрал». Иначе отражение внешнего состояния в
        // контроле уходило бы в бесконечный цикл.
        const { select } = mount(["a", "b"]);
        let fired = 0;
        select.onDidSelect = () => fired++;

        select.select(1);

        expect(fired).toBe(0);
    });

    it("правая кнопка список не трогает", () => {
        const { select } = mount(["a", "b"]);

        select.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "right", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
        );

        expect(select.isOpen()).toBe(false);
    });

    it("посторонняя клавиша списка не открывает", () => {
        const { select, app } = mount(["a", "b"]);
        select.focus();

        app.sendKey("x");

        expect(select.isOpen()).toBe(false);
    });

    it("разделитель в списке не выбирается", () => {
        const select = new SelectBoxElement();
        select.setOptions([{ text: "a" }, { text: "", isSeparator: true }, { text: "b" }], 0);
        const app = TestApp.createWithContent(select, new Size(40, 12));
        app.render();
        select.focus();

        app.sendKey("Enter");
        // ArrowDown перепрыгивает разделитель — попадаем сразу на «b».
        app.sendKey("ArrowDown");
        app.sendKey("Enter");

        expect(select.getSelected()).toBe(2);
    });

    it("вне дерева (без overlay-слоя) раскрытие — no-op", () => {
        const select = new SelectBoxElement();
        select.setOptions([{ text: "a" }], 0);

        expect(() =>
            select.dispatchEvent(
                new TUIMouseEvent("mousedown", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
            ),
        ).not.toThrow();
        expect(select.isOpen()).toBe(false);
    });

    it("нулевая ширина не роняет отрисовку", () => {
        const { select } = mount(["a"]);
        expect(() => renderElement(select, 0, 1)).not.toThrow();
    });

    it("токены dropdown.* доезжают и до закрытого состояния, и до раскрытого списка", () => {
        const { select, app } = mount(["alpha"]);
        app.root.setStyleVars({
            "dropdown.foreground": packRgb(1, 2, 3),
            "dropdown.background": packRgb(4, 5, 6),
            "dropdown.border": packRgb(7, 8, 9),
            "dropdown.listBackground": packRgb(10, 11, 12),
        });
        app.render();

        select.focus();
        app.sendKey("Enter");

        expect(select.isOpen()).toBe(true);
        expect(screenText(app)).toContain("alpha");
    });

    it("клавиша по уже раскрытому списку его закрывает", () => {
        // Тот же путь toggle, что и при клике: список открыт — повтор закрывает.
        const { select, app } = mount(["a", "b"]);
        select.focus();
        app.sendKey("Enter");
        expect(select.isOpen()).toBe(true);

        select.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));

        expect(select.isOpen()).toBe(false);
    });

    it("intrinsic-размеры: одна строка, ширина по содержимому", () => {
        const { select } = mount(["alpha", "beta"]);

        expect(select.getMinIntrinsicHeight(10)).toBe(1);
        expect(select.getMaxIntrinsicHeight(10)).toBe(1);
        expect(select.getMinIntrinsicWidth(1)).toBe(select.getMaxIntrinsicWidth(1));
    });

    it("клик мышью раскрывает список", () => {
        const { select } = mount(["a", "b"]);

        select.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 }),
        );

        expect(select.isOpen()).toBe(true);
    });
});
