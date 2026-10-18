import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";
import type { QuickPickSessionItem } from "./quickPickSession.ts";

/** Всё, что пикер сообщил владельцу, — в порядке прихода. */
type Logged = ["value", string] | ["accept"] | ["active", string[]] | ["selection", string[]] | ["hide"];

function setup() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    const log: Logged[] = [];
    const labels = (items: readonly QuickPickSessionItem[]): string[] => items.map((item) => item.label);
    const pick = service.createQuickPick<QuickPickSessionItem>({
        onDidChangeValue: (value) => log.push(["value", value]),
        onDidAccept: () => log.push(["accept"]),
        onDidChangeActive: (items) => log.push(["active", labels(items)]),
        onDidChangeSelection: (items) => log.push(["selection", labels(items)]),
        onDidHide: () => log.push(["hide"]),
    });
    /** Что сейчас на виджете — тот же снимок, что видит инспектор и e2e. */
    const view = (): Record<string, unknown> => component.view.inspectState();
    const type = (text: string): void => {
        for (const ch of text) testApp.sendKey(ch);
    };
    return { service, component, testApp, pick, log, view, type };
}

const FRUITS: QuickPickSessionItem[] = [
    { label: "apple", description: "red" },
    { label: "banana", detail: "long yellow" },
    { label: "cherry" },
];

describe("QuickPickSession — показ и живое состояние", () => {
    it("скрытый пикер копит состояние и показывает его на show()", () => {
        const { pick, component, view } = setup();
        pick.update({ title: "Fruit", placeholder: "pick one", items: FRUITS });
        expect(component.isOpen()).toBe(false);

        pick.show();

        expect(component.isOpen()).toBe(true);
        expect(view()).toMatchObject({ title: "Fruit", items: ["apple", "banana", "cherry"], activeIndex: 0 });
        expect(component.view.placeholder).toBe("pick one");
    });

    it("предметы, присланные ПОСЛЕ показа, появляются в открытом пикере", () => {
        // Ровно сценарий pickLazyEnum golang.go: show() с пустым списком,
        // предметы приезжают ответом языкового сервера.
        const { pick, view, log } = setup();
        pick.show();
        expect(view()).toMatchObject({ items: [] });

        pick.update({ items: FRUITS });

        expect(view()).toMatchObject({ items: ["apple", "banana", "cherry"] });
        expect(log).toContainEqual(["active", ["apple"]]);
    });

    it("заголовок с шагами — как getTitle эталона", () => {
        const { pick, view } = setup();
        pick.update({ title: "Wizard", step: 2, totalSteps: 3 });
        pick.show();
        expect(view()).toMatchObject({ title: "Wizard (2/3)" });

        pick.update({ totalSteps: undefined });
        expect(view()).toMatchObject({ title: "Wizard (2)" });

        pick.update({ title: undefined, totalSteps: 3 });
        expect(view()).toMatchObject({ title: "2/3" });
    });
});

describe("QuickPickSession — ввод", () => {
    it("набор фильтрует по label и сообщает значение и подсветку", () => {
        const { pick, view, log, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;

        type("ch");

        expect(view()).toMatchObject({ query: "ch", items: ["cherry"] });
        // На «c» остаётся одна cherry — подсветка сменилась; «ch» её не двигает.
        expect(log).toEqual([
            ["value", "c"],
            ["active", ["cherry"]],
            ["value", "ch"],
        ]);
    });

    it("matchOnDescription / matchOnDetail расширяют поиск, alwaysShow не прячется", () => {
        const { pick, view, type } = setup();
        pick.update({ items: [...FRUITS, { label: "other", alwaysShow: true }] });
        pick.show();
        type("yel");
        expect(view()).toMatchObject({ items: ["other"] });

        pick.update({ matchOnDetail: true });
        expect(view()).toMatchObject({ items: ["banana", "other"] });

        pick.update({ value: "red", matchOnDescription: true });
        expect(view()).toMatchObject({ items: ["apple", "other"] });
    });

    it("программный value меняет запрос и тоже даёт onDidChangeValue", () => {
        const { pick, view, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;

        pick.update({ value: "ban" });

        expect(view()).toMatchObject({ query: "ban", items: ["banana"] });
        expect(log).toEqual([
            ["value", "ban"],
            ["active", ["banana"]],
        ]);
    });

    it("Enter выбирает подсвеченное и сообщает о принятии, но НЕ закрывает", () => {
        const { pick, component, testApp, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        testApp.sendKey("ArrowDown");
        log.length = 0;

        testApp.sendKey("Enter");

        expect(log).toEqual([["selection", ["banana"]], ["accept"]]);
        expect(component.isOpen()).toBe(true);
        expect(pick.getState().selectedItems.map((item) => item.label)).toEqual(["banana"]);
    });

    it("Enter на пустом списке — принятие без выбора (набранный текст)", () => {
        const { pick, testApp, log, type } = setup();
        pick.show();
        type("x");
        log.length = 0;

        testApp.sendKey("Enter");

        expect(log).toEqual([["accept"]]);
    });

    it("стрелка — onDidChangeActive, программный activeItems — молча", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        log.length = 0;

        testApp.sendKey("ArrowDown");
        expect(log).toEqual([["active", ["banana"]]]);

        log.length = 0;
        pick.update({ activeItems: [FRUITS[2]] });
        expect(view()).toMatchObject({ activeIndex: 2 });
        expect(log).toEqual([]);
    });

    it("keepScrollPosition: новые предметы не уводят подсветку наверх", () => {
        const { pick, view, testApp } = setup();
        pick.update({ items: FRUITS, keepScrollPosition: true });
        pick.show();
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");

        pick.update({ items: [...FRUITS, { label: "date" }] });
        expect(view()).toMatchObject({ activeIndex: 2 });

        pick.update({ keepScrollPosition: false, items: FRUITS });
        expect(view()).toMatchObject({ activeIndex: 0 });
    });
});

describe("QuickPickSession — множественный выбор", () => {
    it("Space переключает отметку и сообщает набор в порядке списка; Enter — принятие", () => {
        const { pick, view, testApp, log } = setup();
        pick.update({ items: FRUITS, canSelectMany: true });
        pick.show();
        log.length = 0;

        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("ArrowUp");
        testApp.sendKey("ArrowUp");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");

        expect(view()).toMatchObject({ checked: ["apple", "cherry"] });
        expect(log.filter((entry) => entry[0] !== "active")).toEqual([
            ["selection", ["cherry"]],
            ["selection", ["apple", "cherry"]],
            ["accept"],
        ]);
    });

    it("selectedItems владельца — отметки на экране, и они переживают новые предметы", () => {
        const { pick, view } = setup();
        pick.update({ items: FRUITS, canSelectMany: true, selectedItems: [FRUITS[1]] });
        pick.show();
        expect(view()).toMatchObject({ checked: ["banana"] });

        pick.update({ selectedItems: [FRUITS[0], FRUITS[2]] });
        expect(view()).toMatchObject({ checked: ["apple", "cherry"] });

        pick.update({ items: [...FRUITS] });
        expect(view()).toMatchObject({ checked: ["apple", "cherry"] });
    });
});

describe("QuickPickSession — скрытие", () => {
    it("Escape закрывает и даёт onDidHide; показать можно снова, состояние на месте", () => {
        const { pick, component, testApp, log, view, type } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        type("ap");
        testApp.sendKey("Escape");

        expect(component.isOpen()).toBe(false);
        expect(log.at(-1)).toEqual(["hide"]);
        expect(pick.visible).toBe(false);

        pick.show();
        expect(view()).toMatchObject({ query: "ap", items: ["apple"] });
    });

    it("hide() владельца закрывает и даёт onDidHide ровно один раз", () => {
        const { pick, component, log } = setup();
        pick.show();
        pick.hide();
        pick.hide();
        expect(component.isOpen()).toBe(false);
        expect(log.filter((entry) => entry[0] === "hide")).toHaveLength(1);
    });

    it("чужой показ на общем виджете перехватывает его — пикер узнаёт onDidHide", () => {
        const { pick, service, log } = setup();
        pick.show();
        void service.input({ prompt: "other" });
        expect(log.at(-1)).toEqual(["hide"]);
        expect(pick.visible).toBe(false);
    });

    it("hide() после перехвата не трогает чужой показ", () => {
        const { pick, service, component } = setup();
        pick.show();
        void service.input({ prompt: "other" });
        pick.hide();
        expect(component.isOpen()).toBe(true);
        expect(component.view.prompt).toBe("other");
    });

    it("dispose скрывает, а после него пикер мёртв", () => {
        const { pick, component, log } = setup();
        pick.update({ items: FRUITS });
        pick.show();
        pick.dispose();
        expect(component.isOpen()).toBe(false);
        expect(log.at(-1)).toEqual(["hide"]);

        pick.show();
        pick.update({ title: "late" });
        expect(component.isOpen()).toBe(false);
        expect(pick.getState().title).toBeUndefined();
    });

    it("показ без изменений состояния — без лишних событий о скрытии", () => {
        const { pick, log } = setup();
        pick.show();
        pick.show();
        expect(log.filter((entry) => entry[0] === "hide")).toEqual([]);
    });
});
