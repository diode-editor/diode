import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../src/TestUtils/TestApp.ts";
import { BoxConstraints, Point, Size } from "../common/geometryPromitives.ts";
import { InputElement } from "../ui/inputbox/inputElement.ts";
import { ListViewElement } from "../ui/list/listViewElement.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

import { TUIElement } from "./tuiElement.ts";

// Регресс-тесты damage-tracking кадра (docs/TODO/SearchPerformance.md, случай 4;
// docs/TODO/LongLinePerformance.md, «Глубже»): экран — ретейн-буфер, кадр
// перерисовывает только повреждённые области. Каждая проверка «сделал меньше
// работы» (spy render соседа) идёт в паре с read-back корректности экрана —
// иначе no-op проходил бы тесты.

/** Контейнер с двумя лейблами: A в (0,0), B в (12,0), каждый 8×1. */
class TwoLabelsElement extends TUIElement {
    public readonly paneA = new TextLabelElement("AAAA");
    public readonly paneB = new TextLabelElement("BBBB");

    public constructor() {
        super();
        this.appendChild(this.paneA);
        this.appendChild(this.paneB);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const pane = BoxConstraints.tight(new Size(8, 1));
        if (!this.paneA.hidden) this.layoutChild(this.paneA, 0, 0, pane);
        if (!this.paneB.hidden) this.layoutChild(this.paneB, 12, 0, pane);
        return size;
    }
}

describe("TuiApplication — damage-tracking кадра", () => {
    it("изменение виджета не рендерит соседа; экран корректен", () => {
        const panes = new TwoLabelsElement();
        const app = TestApp.createWithContent(panes, new Size(30, 5));

        const spyB = vi.spyOn(panes.paneB, "render");
        panes.paneA.setText("XXXX");
        app.render();

        expect(spyB).not.toHaveBeenCalled();
        expect(app.backend.getTextAt(new Point(0, 0), 4)).toBe("XXXX");
        expect(app.backend.getTextAt(new Point(12, 0), 4)).toBe("BBBB");
    });

    it("кадр без damage не перерисовывает ничего, но считается кадром", () => {
        const panes = new TwoLabelsElement();
        const app = TestApp.createWithContent(panes, new Size(30, 5));

        const spyA = vi.spyOn(panes.paneA, "render");
        const before = app.app.frameCount;
        app.render();

        expect(app.app.frameCount - before).toBe(1); // семантика idleWaiter
        expect(spyA).not.toHaveBeenCalled();
        expect(app.backend.getTextAt(new Point(0, 0), 4)).toBe("AAAA");
    });

    it("скрытие освобождает ячейки, показ возвращает контент", () => {
        const panes = new TwoLabelsElement();
        const app = TestApp.createWithContent(panes, new Size(30, 5));

        panes.paneB.hidden = true;
        app.render();
        expect(app.backend.getTextAt(new Point(12, 0), 4)).toBe("    ");

        panes.paneB.hidden = false;
        app.render();
        expect(app.backend.getTextAt(new Point(12, 0), 4)).toBe("BBBB");
    });

    it("закрытие оверлея восстанавливает контент под ним", () => {
        const panes = new TwoLabelsElement();
        const app = TestApp.createWithContent(panes, new Size(30, 5));
        const popup = new TextLabelElement("PPPP");

        app.root.overlayLayer.addItem(popup, new Point(0, 0), true);
        app.render();
        expect(app.backend.getTextAt(new Point(0, 0), 4)).toBe("PPPP");

        app.root.overlayLayer.removeItem(popup);
        app.render();
        expect(app.backend.getTextAt(new Point(0, 0), 4)).toBe("AAAA");
    });

    it("wide-char на границе damage-области не рассекается", () => {
        const panes = new AdjacentLabelsElement();
        // «AB你好» = 6 колонок: голова 好 в col 4, продолжение в col 5 —
        // впритык к панели B (col 6). Damage B после дилатации начинается с
        // col 5 и рассёк бы пару; снап к границам wide-пар тянет кромку до
        // головы, и 好 перерисовывается целиком.
        const app = TestApp.createWithContent(panes, new Size(30, 5));
        expect(app.backend.getTextAt(new Point(0, 0), 6)).toBe("AB你好");

        panes.paneB.setText("ZZZZ");
        app.render();

        expect(app.backend.getTextAt(new Point(0, 0), 6)).toBe("AB你好");
        expect(app.backend.getTextAt(new Point(6, 0), 4)).toBe("ZZZZ");
    });

    it("курсор фокусированного виджета переживает кадр без его damage", () => {
        const container = new InputAndLabelElement();
        const app = TestApp.createWithContent(container, new Size(30, 5));
        container.input.focus();
        app.render(); // устаканить фокус-перерисовку
        const cursorBefore = app.app.screen.cursorPosition;
        expect(cursorBefore).not.toBeNull();

        // Damage только у лейбла — курсор инпута не гаснет.
        const spyInput = vi.spyOn(container.input, "render");
        container.label.setText("NEW");
        app.render();

        expect(spyInput).not.toHaveBeenCalled();
        expect(app.app.screen.cursorPosition).toEqual(cursorBefore);
        expect(app.backend.getTextAt(new Point(22, 3), 3)).toBe("NEW");
    });

    it("стрелка в фокусированном списке не рендерит соседний виджет", () => {
        const container = new ListAndLabelElement();
        const app = TestApp.createWithContent(container, new Size(30, 8));
        container.list.focus();
        app.render(); // устаканить фокус-перерисовку

        const spyLabel = vi.spyOn(container.label, "render");
        app.sendKey("ArrowDown");

        expect(container.list.inspectState().cursorId).toBe("r1");
        expect(spyLabel).not.toHaveBeenCalled();
        expect(app.backend.getTextAt(new Point(22, 0), 4)).toBe("LBL ");
    });
});

/** Смежные лейблы: A «AB你好» 6×1 в (0,0), B 8×1 сразу за ним в (6,0). */
class AdjacentLabelsElement extends TUIElement {
    public readonly paneA = new TextLabelElement("AB你好");
    public readonly paneB = new TextLabelElement("BBBB");

    public constructor() {
        super();
        this.appendChild(this.paneA);
        this.appendChild(this.paneB);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.layoutChild(this.paneA, 0, 0, BoxConstraints.tight(new Size(6, 1)));
        this.layoutChild(this.paneB, 6, 0, BoxConstraints.tight(new Size(8, 1)));
        return size;
    }
}

/** Инпут 15×1 в (0,0), лейбл 6×1 в (22,3). */
class InputAndLabelElement extends TUIElement {
    public readonly input = new InputElement();
    public readonly label = new TextLabelElement("LBL");

    public constructor() {
        super();
        this.appendChild(this.input);
        this.appendChild(this.label);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.layoutChild(this.input, 0, 0, BoxConstraints.tight(new Size(15, 1)));
        this.layoutChild(this.label, 22, 3, BoxConstraints.tight(new Size(6, 1)));
        return size;
    }
}

/** Список 20×6 слева, лейбл в (22,0) 6×1 справа. */
class ListAndLabelElement extends TUIElement {
    public readonly list = new ListViewElement({ typeahead: false });
    public readonly label = new TextLabelElement("LBL");

    public constructor() {
        super();
        for (let i = 0; i < 10; i++) {
            const row = new TextLabelElement(`row ${i}`);
            row.id = `r${i}`;
            this.list.appendRow(row);
        }
        this.appendChild(this.list);
        this.appendChild(this.label);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.layoutChild(this.list, 0, 0, BoxConstraints.tight(new Size(20, 6)));
        this.layoutChild(this.label, 22, 0, BoxConstraints.tight(new Size(6, 1)));
        return size;
    }
}
