import { describe, expect, it } from "vitest";

import type { PaneViewElement } from "./paneViewElement.ts";
import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "./viewsService.testUtils.ts";

const PANEL = "workbench.panel.output";

/** Занят ли заголовок секции — тот же путь, которым это читает e2e. */
function paneBusy(paneView: PaneViewElement, id: string): boolean {
    const header = paneView.querySelector(`#paneHeader-${id.replaceAll(".", "-")}`);
    return header?.inspectState()?.busy === true;
}

function scmHarness(views: string[]): IViewsHarness {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
    views.forEach((id, index) => h.service.registerView(testView(id, "scm", (index + 1) * 10)));
    h.service.attachContainer("scm");
    return h;
}

describe("ViewsService — спиннер занятости", () => {
    it("кадр доезжает до заголовка своей секции и снимается", () => {
        const h = scmHarness(["scm.changes", "scm.graph"]);

        h.service.setViewSpinner("scm.changes", "◐");
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);
        expect(paneBusy(h.paneView("scm"), "scm.graph")).toBe(false);

        // Повтор того же кадра — no-op.
        h.service.setViewSpinner("scm.changes", "◐");
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);

        h.service.setViewSpinner("scm.changes", null);
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(false);
    });

    it("кадр переживает пересборку секций", () => {
        const h = scmHarness(["scm.changes", "scm.graph"]);
        h.service.setViewSpinner("scm.changes", "◐");

        // Скрытие соседа пересоздаёт панели контейнера.
        h.service.setViewVisible("scm.graph", false);
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);

        h.service.setViewVisible("scm.graph", true);
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);
    });

    it("скрытая секция запоминает кадр и показывает его, когда вернётся", () => {
        const h = scmHarness(["scm.changes", "scm.graph"]);
        h.service.setViewVisible("scm.graph", false);

        h.service.setViewSpinner("scm.graph", "◐");
        h.service.setViewVisible("scm.graph", true);
        expect(paneBusy(h.paneView("scm"), "scm.graph")).toBe(true);
    });

    it("у merged-секции панели кадр уходит в полосу контролов таб-строки", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: PANEL, title: "OUTPUT", location: "panel" });
        h.service.registerView(testView("panel.output", PANEL, 10));
        h.service.attachContainer(PANEL);
        // Показывать нечего — полосы в таб-строке нет вовсе.
        expect(h.header(PANEL)).toBeNull();

        h.service.setViewSpinner("panel.output", "◐");
        expect(h.header(PANEL)?.inspectState()).toEqual({ title: "", busy: true });

        // Кадр сменился — полоса на месте и лишний раз не пересобирается.
        h.service.setViewSpinner("panel.output", "◓");
        expect(h.header(PANEL)?.inspectState()).toEqual({ title: "", busy: true });

        // Операция кончилась — полосе снова нечего показывать.
        h.service.setViewSpinner("panel.output", null);
        expect(h.header(PANEL)).toBeNull();
    });

    it("в панели с несколькими секциями кадр уходит в заголовок своей секции", () => {
        // Не-merged панель: заголовка-цели у контейнера нет, и путь «отдать кадр
        // полосе таб-строки» здесь не должен даже пытаться его читать.
        const h = makeViewsHarness();
        h.service.registerContainer({ id: PANEL, title: "PANEL", location: "panel" });
        h.service.registerView(testView("panel.output", PANEL, 10));
        h.service.registerView(testView("panel.problems", PANEL, 20));
        h.service.attachContainer(PANEL);

        expect(() => h.service.setViewSpinner("panel.problems", "◐")).not.toThrow();
        const header = h.paneView(PANEL).querySelector("#paneHeader-panel-problems");
        expect(header?.inspectState()?.busy).toBe(true);
    });

    it("прогресс незарегистрированной view — молчаливый no-op", () => {
        const h = scmHarness(["scm.changes"]);
        expect(() => h.service.setViewSpinner("search", "◐")).not.toThrow();
    });

    it("кадр до attachContainer запоминается и доезжает при показе контейнера", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar" });
        h.service.registerView(testView("scm.changes", "scm", 10));

        h.service.setViewSpinner("scm.changes", "◐");
        h.service.attachContainer("scm");
        expect(paneBusy(h.paneView("scm"), "scm.changes")).toBe(true);
    });
});
