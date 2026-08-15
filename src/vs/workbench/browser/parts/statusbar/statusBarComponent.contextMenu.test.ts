import { describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import type { HFlexLayoutStyle } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { CHECKED_ICON } from "../../../../platform/actions/common/menuRegistry.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { createStatusBarHarness, statusTexts } from "./statusBarComponent.testUtils.ts";

const SCREEN = new Size(60, 10);
/** Полоса — нижний ряд body, как в приложении. */
const BAR_Y = SCREEN.height - 1;

function rightClick(x: number, y: number, action: "press" | "release"): MouseToken {
    return {
        kind: "mouse",
        button: "right",
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

interface MenuHarness {
    app: TestApp;
    statusBarService: StatusBarService;
    /** Правый клик по первой ячейке текста сегмента (null — по пустому месту полосы). */
    openMenuOn: (text: string | null) => void;
    /** Сработавшие команды сегментов — правый клик их дёргать не должен. */
    clicks: string[];
    segments: () => string[];
}

/** Наблюдаемое состояние открытого меню (пункты + выделение) глазами инспектора. */
function menuState(app: TestApp): { items: (string | null)[]; selectedIndex: number } {
    const menu = app.querySelector("PopupMenuElement");
    const state = menu?.inspectState();
    if (state === undefined) throw new Error("контекстное меню не открыто");
    return { items: state.items as (string | null)[], selectedIndex: state.selectedIndex as number };
}

/** Пункты открытого меню (сепараторы — null). */
function menuItems(app: TestApp): (string | null)[] {
    return menuState(app).items;
}

/** Доводит выделение до пункта с этим label и активирует его — как пользователь. */
function activateMenuItem(app: TestApp, label: string): void {
    const target = menuItems(app).indexOf(label);
    if (target < 0) throw new Error(`в меню нет пункта "${label}"`);
    while (menuState(app).selectedIndex !== target) {
        app.sendKey("ArrowDown");
    }
    app.sendKey("Enter");
    app.render();
}

function setup(): MenuHarness {
    const harness = createStatusBarHarness();
    const clicks: string[] = [];
    harness.statusBarService.addEntry({
        id: "alpha",
        name: "Alpha",
        text: "Alpha",
        alignment: "left",
        priority: 10,
        onClick: () => clicks.push("alpha"),
    });
    harness.statusBarService.addEntry({ id: "beta", name: "Beta", text: "Beta", alignment: "left", priority: 5 });
    // Транзиентный сегмент без имени — в меню его быть не должно.
    harness.statusBarService.addEntry({ id: "hint", text: "chord", alignment: "left", priority: 1 });
    harness.statusBarService.addEntry({ id: "omega", name: "Omega", text: "Omega", alignment: "right", priority: 1 });

    const body = new BodyElement();
    body.setStatusBar(harness.component.view);
    const app = TestApp.create(body, SCREEN);
    app.render();

    const openMenuOn = (text: string | null): void => {
        const children = harness.component.view.getChildren();
        let x: number;
        if (text === null) {
            // Пустое место — центральный распорный Filler между сторонами.
            const fill = children.find((child) => (child.layoutStyle as HFlexLayoutStyle).width.type === "fill");
            if (!fill) throw new Error("на полосе нет центрального распора");
            x = fill.globalPosition.x + Math.floor(fill.layoutSize.width / 2);
        } else {
            const label = children.find(
                (child): child is TextLabelElement =>
                    child instanceof TextLabelElement && child.getText() === ` ${text} `,
            );
            if (!label) throw new Error(`status bar has no segment "${text}"`);
            x = label.globalPosition.x + 1;
        }
        app.backend.simulateMouse(rightClick(x, BAR_Y, "press"));
        app.backend.simulateMouse(rightClick(x, BAR_Y, "release"));
        app.render();
    };

    return {
        app,
        statusBarService: harness.statusBarService,
        openMenuOn,
        clicks,
        segments: () => statusTexts(harness.component.view),
    };
}

describe("StatusBarComponent — меню видимости", () => {
    it("правый клик по полосе открывает переключатель именованных записей", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("Alpha");

        // Транзиентной записи без name («chord») в переключателе нет; правые
        // сегменты идут после левых, как в порядке отрисовки.
        expect(menuItems(app)).toEqual(["Terminal Environment", "Alpha", "Beta", "Omega", null, "Hide 'Alpha'"]);
        // Видимые записи отмечены галочкой.
        expect(app.backend.screenToString()).toContain(`${CHECKED_ICON} Alpha`);
    });

    it("правый клик по кликабельному сегменту не запускает его команду", () => {
        const { openMenuOn, clicks } = setup();

        openMenuOn("Alpha");

        expect(clicks).toEqual([]);
    });

    it("меню несёт «Hide 'X'» для сегмента под курсором", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("Beta");

        expect(app.backend.screenToString()).toContain("Hide 'Beta'");
    });

    it("правый клик мимо сегментов даёт меню без «Hide»", () => {
        const { app, openMenuOn } = setup();

        openMenuOn(null);

        expect(menuItems(app)).toEqual(["Terminal Environment", "Alpha", "Beta", "Omega"]);
    });

    it("правый клик по транзиентному сегменту без name тоже не даёт «Hide»", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("chord");

        expect(menuItems(app)).toEqual(["Terminal Environment", "Alpha", "Beta", "Omega"]);
    });

    it("«Hide 'X'» работает и для правых сегментов", () => {
        const { app, openMenuOn, segments } = setup();

        openMenuOn("Omega");
        expect(menuItems(app)).toContain("Hide 'Omega'");

        activateMenuItem(app, "Hide 'Omega'");
        expect(segments()).not.toContain("Omega");
    });

    it("меню раскрывается вверх — полоса это нижний ряд экрана", () => {
        const { app, openMenuOn } = setup();

        openMenuOn("Alpha");

        const menu = app.querySelector("PopupMenuElement");
        expect(menu).not.toBeNull();
        expect(menu!.globalPosition.y + menu!.layoutSize.height).toBeLessThanOrEqual(BAR_Y);
    });

    it("снятие галочки убирает сегмент с полосы", () => {
        const { app, openMenuOn, segments, statusBarService } = setup();
        expect(segments()).toContain("Alpha");

        openMenuOn("Alpha");
        activateMenuItem(app, "Alpha");

        expect(statusBarService.isHidden("alpha")).toBe(true);
        expect(segments()).not.toContain("Alpha");
        expect(app.querySelector("PopupMenuElement")).toBeNull();
    });

    it("«Hide 'X'» скрывает сегмент под курсором", () => {
        const { app, openMenuOn, segments } = setup();

        openMenuOn("Beta");
        activateMenuItem(app, "Hide 'Beta'");

        expect(segments()).not.toContain("Beta");
    });

    it("скрытая запись остаётся в меню без галочки — её можно вернуть", () => {
        const { app, openMenuOn, segments, statusBarService } = setup();
        statusBarService.setHidden("alpha", true);
        app.render();
        expect(segments()).not.toContain("Alpha");

        openMenuOn(null);
        expect(menuItems(app)).toContain("Alpha");
        expect(app.backend.screenToString()).not.toContain(`${CHECKED_ICON} Alpha`);

        activateMenuItem(app, "Alpha");
        expect(segments()).toContain("Alpha");
    });
});
