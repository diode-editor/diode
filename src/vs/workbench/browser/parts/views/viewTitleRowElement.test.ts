import { describe, expect, it } from "vitest";

import { BoxConstraints, Point, Size } from "@tuidom/core/common/geometryPromitives";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { ViewTitleRowElement } from "./viewTitleRowElement.ts";

const CHEVRON_EXPANDED = "";
const CHEVRON_COLLAPSED = "";

function layout(row: ViewTitleRowElement, width = 30): ViewTitleRowElement {
    row.layout(BoxConstraints.tight(new Size(width, 1)));
    return row;
}

function titleText(row: ViewTitleRowElement): string {
    return (row.querySelector("TextLabelElement") as TextLabelElement).getText();
}

describe("ViewTitleRowElement — название", () => {
    it("шеврон отражает свёрнутость", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES`);
        row.setExpanded(false);
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} CHANGES`);
    });

    it("без шеврона — только отступ и название", () => {
        const row = layout(new ViewTitleRowElement("SOURCE CONTROL", { chevron: false }));
        expect(titleText(row)).toBe(" SOURCE CONTROL");
        // Шеврона нет — свёрнутость не рисуется, но и не ломает строку.
        row.setExpanded(false);
        expect(titleText(row)).toBe(" SOURCE CONTROL");
    });

    it("setTitle меняет надпись, повтор того же — no-op", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setTitle("GRAPH");
        expect(row.getTitle()).toBe("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} GRAPH`);
        row.setTitle("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} GRAPH`);
    });

    it("setExpanded в то же состояние — no-op", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setExpanded(true);
        expect(row.isExpanded).toBe(true);
    });
});

describe("ViewTitleRowElement — зоны кнопок", () => {
    it("название, кнопки и ⋯ разложены по зонам в порядке справа налево", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);

        // Ширина 30: ⋯ занимает 27..29, перед ней разделитель на 26, кнопка
        // 23..25, ещё разделитель на 22 и кнопка 19..21.
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.collapse" });
        expect(row.hitZone(20)).toEqual({ kind: "action", actionId: "cmd.refresh" });
        // Разделитель — не кнопка: клик по нему достаётся заголовку.
        expect(row.hitZone(26)).toEqual({ kind: "title" });
        expect(row.hitZone(2)).toEqual({ kind: "title" });
        expect(row.menuAnchorX).toBe(27);
    });

    it("узкий заголовок клипует кнопки — у схлопнутых зоны нет", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row, 4);
        expect(row.hitZone(3)).toEqual({ kind: "title" });
    });

    it("пересобирает кнопки, когда меняется любое поле любой из них", () => {
        // Ранний выход setActions сравнивает состав поэлементно: пропущенная
        // разница означает кнопку, застрявшую в прошлом состоянии.
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);

        // Сменился id второй кнопки — клик по ней обязан исполнять уже другую команду.
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.expand", icon: "C" },
        ]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.expand" });

        // Сменилась иконка второй кнопки — на экране обязан быть новый глиф.
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.expand", icon: "E" },
        ]);
        layout(row);
        expect(renderElement(row, 30, 1, { themeVars: true }).screenToString()).toContain("E");
    });

    it("setActions тем же составом — no-op, другим — пересобирает зоны", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setActions([]);
        layout(row);
        expect(row.hitZone(24)).toEqual({ kind: "title" });
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });
});

describe("ViewTitleRowElement — скрытая кнопка «⋯»", () => {
    it("setMenuVisible(false) убирает кнопку и её зону, true — возвращает", () => {
        const row = new ViewTitleRowElement("OUTPUT", { chevron: false });
        row.setActions([{ id: "cmd.clear", icon: "C" }]);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });

        row.setMenuVisible(false);
        layout(row);
        // Кнопка осталась одна — уехала к правому краю, разделителя больше нет.
        expect(row.hitZone(28)).toEqual({ kind: "action", actionId: "cmd.clear" });
        // Повтор того же состояния — no-op.
        row.setMenuVisible(false);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "action", actionId: "cmd.clear" });

        // Колонки, где «⋯» была до скрытия, больше не кликаются как меню.
        row.setActions([]);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "title" });

        row.setMenuVisible(true);
        layout(row);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });
    });
});

describe("ViewTitleRowElement — подсветка под курсором", () => {
    const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
    const HOVER_BG = theme.getColor("toolbar.hoverBackground")!;

    /** Фон колонки после рендера строки (движок сам hover лейблам не ставит). */
    function bgAt(row: ViewTitleRowElement, x: number): number {
        return renderElement(row, 30, 1, { themeVars: true }).getBgAt(new Point(x, 0));
    }

    it("подсвечивается ровно та кнопка, над которой курсор", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);
        const restBg = bgAt(row, 20);
        expect(restBg).not.toBe(HOVER_BG);

        row.setHoveredZone(row.hitZone(20));
        expect(bgAt(row, 20)).toBe(HOVER_BG);
        // Соседняя кнопка и разделитель остаются в покое.
        expect(bgAt(row, 24)).toBe(restBg);
        expect(bgAt(row, 22)).toBe(restBg);

        row.setHoveredZone(row.hitZone(28));
        expect(bgAt(row, 28)).toBe(HOVER_BG);
        expect(bgAt(row, 20)).toBe(restBg);

        // Курсор на названии — не подсвечено ничего.
        row.setHoveredZone(row.hitZone(2));
        expect(bgAt(row, 28)).toBe(restBg);

        row.setHoveredZone(null);
        expect(bgAt(row, 28)).toBe(restBg);
    });
});

describe("ViewTitleRowElement — недоступная кнопка", () => {
    const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
    const DISABLED_FG = theme.getColor("disabledForeground")!;
    const ENABLED_FG = theme.getColor("descriptionForeground")!;
    const HOVER_BG = theme.getColor("toolbar.hoverBackground")!;

    function render(row: ViewTitleRowElement): ReturnType<typeof renderElement> {
        return renderElement(row, 30, 1, { themeVars: true });
    }

    it("рисуется приглушённой, доступная — обычной", () => {
        const row = new ViewTitleRowElement("GRAPH");
        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: false }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(DISABLED_FG);

        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: true }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);
    });

    it("смена только доступности пересобирает кнопки", () => {
        // Регресс на sameActions: ранний выход setActions не должен съедать
        // смену enabled — иначе кнопка навсегда остаётся в исходном виде.
        const row = new ViewTitleRowElement("GRAPH");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);

        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: false }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(DISABLED_FG);

        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: true }]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);
    });

    it("гаснет ровно та кнопка, что стала недоступной", () => {
        // Вторая кнопка в ряду: поэлементное сравнение обязано заметить разницу
        // не только в первой.
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C" },
        ]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(ENABLED_FG);

        row.setActions([
            { id: "cmd.refresh", icon: "R" },
            { id: "cmd.collapse", icon: "C", enabled: false },
        ]);
        layout(row);
        expect(render(row).getFgAt(new Point(24, 0))).toBe(DISABLED_FG);
        // Соседняя осталась доступной.
        expect(render(row).getFgAt(new Point(20, 0))).toBe(ENABLED_FG);
    });

    it("под курсором не подсвечивается, но зону сохраняет", () => {
        const row = new ViewTitleRowElement("GRAPH");
        row.setActions([{ id: "cmd.refresh", icon: "R", enabled: false }]);
        layout(row);

        const zone = row.hitZone(24);
        // Зона остаётся за кнопкой: без неё клик провалился бы в заголовок и
        // свернул секцию.
        expect(zone).toEqual({ kind: "action", actionId: "cmd.refresh" });

        row.setHoveredZone(zone);
        expect(render(row).getBgAt(new Point(24, 0))).not.toBe(HOVER_BG);
    });
});

describe("ViewTitleRowElement — спиннер занятости", () => {
    it("кадр встаёт сразу после названия и снимается обратно", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        expect(row.isBusy).toBe(false);

        row.setSpinnerFrame("◐");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES ◐`);
        expect(row.isBusy).toBe(true);

        // Кадр сменился — надпись обновилась, повтор того же кадра no-op.
        row.setSpinnerFrame("◓");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES ◓`);
        row.setSpinnerFrame("◓");
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES ◓`);

        row.setSpinnerFrame(null);
        expect(titleText(row)).toBe(` ${CHEVRON_EXPANDED} CHANGES`);
        expect(row.isBusy).toBe(false);
    });

    it("уживается с шевроном, сменой названия и свёрнутостью", () => {
        const row = layout(new ViewTitleRowElement("CHANGES"));
        row.setSpinnerFrame("◑");
        row.setExpanded(false);
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} CHANGES ◑`);
        row.setTitle("GRAPH");
        expect(titleText(row)).toBe(` ${CHEVRON_COLLAPSED} GRAPH ◑`);
        // Название в состоянии — сырое: спиннер не должен просачиваться в e2e-ассерты.
        expect(row.getTitle()).toBe("GRAPH");
    });

    it("без шеврона — кадр всё равно после названия", () => {
        const row = layout(new ViewTitleRowElement("SOURCE CONTROL", { chevron: false }));
        row.setSpinnerFrame("◐");
        expect(titleText(row)).toBe(" SOURCE CONTROL ◐");
    });

    it("спиннер не сдвигает зоны кнопок", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setActions([{ id: "cmd.refresh", icon: "R" }]);
        layout(row);
        const zoneBefore = row.hitZone(28);

        row.setSpinnerFrame("◐");
        layout(row);
        expect(row.hitZone(28)).toEqual(zoneBefore);
    });

    it("кадр доходит до экрана", () => {
        const row = new ViewTitleRowElement("CHANGES");
        row.setSpinnerFrame("◐");
        const screen = renderElement(row, 30, 1, { themeVars: true });
        expect(screen.screenToString()).toContain("CHANGES ◐");
    });
});

describe("ViewTitleRowElement — виджет заголовка", () => {
    it("виджет встаёт между названием и кнопками и снимается обратно", () => {
        const row = new ViewTitleRowElement("OUTPUT", { chevron: false });
        const widget = new FillerElement();
        widget.id = "channel-picker";

        row.setTitleWidget(widget);
        layout(row);
        expect(row.querySelector("#channel-picker")).toBe(widget);
        expect(row.hitZone(28)).toEqual({ kind: "menu" });

        row.setTitleWidget(widget);
        expect(row.querySelector("#channel-picker")).toBe(widget);

        row.setTitleWidget(null);
        layout(row);
        expect(row.querySelector("#channel-picker")).toBeNull();
    });
});
