import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";

const WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "You have not yet opened a folder." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "openFolder" },
];

/** Пустое состояние секции, которое реально стоит в контейнере (или `null`). */
function placeholderOf(h: IViewsHarness, containerId: string, viewId: string): TUIElement | null {
    return h.paneView(containerId).querySelector(`#viewPlaceholder-${viewId.replaceAll(".", "-")}`);
}

/**
 * Дескриптор с телом, чей id годится в селектор: `testView` зовёт тело
 * `<id>-body`, а в id view есть точка, которую `querySelector` не разберёт.
 */
function viewWithBody(
    id: string,
    containerId: string,
    order: number,
    extra?: Partial<IViewDescriptor>,
): IViewDescriptor {
    const body = new FillerElement();
    body.id = `${id.replaceAll(".", "-")}-body`;
    return { ...view(id, containerId, order, extra), body };
}

/** Стоит ли на экране именно тело секции (а не пустое состояние). */
function bodyShown(h: IViewsHarness, containerId: string, descriptor: IViewDescriptor): boolean {
    const body = descriptor.body;
    if (body === null) throw new Error("bodyShown: дескриптор без тела");
    return h.paneView(containerId).querySelector(`#${String(body.id)}`) === body;
}

describe("ViewsService: интерактивное пустое состояние (viewsWelcome)", () => {
    it("placeholder блоками рисуется welcome-контролом, а строкой — плоской подсказкой", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar" });
        h.service.registerView(view("sb.rich", "sb", 10, { body: null, placeholder: WELCOME }));
        h.service.registerView(view("sb.flat", "sb", 20, { body: null, placeholder: "No output yet." }));
        h.service.attachContainer("sb");

        expect(placeholderOf(h, "sb", "sb.rich")).toBeInstanceOf(ViewWelcomeElement);
        const flat = placeholderOf(h, "sb", "sb.flat");
        expect(flat).toBeInstanceOf(TextLabelElement);
        expect((flat as TextLabelElement).getText()).toBe("No output yet.");
    });

    it("кнопка welcome исполняет объявленную команду через реестр команд", () => {
        const h = makeViewsHarness();
        const ran: unknown[][] = [];
        h.commands.register("openFolder", (...args: unknown[]) => {
            ran.push(args);
        });
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar" });
        h.service.registerView(view("sb.rich", "sb", 10, { body: null, placeholder: WELCOME }));
        h.service.attachContainer("sb");

        const welcome = placeholderOf(h, "sb", "sb.rich") as ViewWelcomeElement;
        const button = welcome.getChildren().find((child) => child instanceof ButtonElement)!;
        button.onActivate?.();

        expect(ran).toEqual([[]]);
    });

    it("welcome у секции без placeholder'а не появляется — пустое состояние остаётся плоским", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar" });
        h.service.registerView(view("sb.empty", "sb", 10, { body: null }));
        h.service.attachContainer("sb");

        const flat = placeholderOf(h, "sb", "sb.empty");
        expect(flat).toBeInstanceOf(TextLabelElement);
        expect((flat as TextLabelElement).getText()).toBe("");
    });
});

describe("ViewsService: секция требует открытой папки", () => {
    /** Search в миниатюре: тело построено заранее, но без папки искать негде. */
    function makeSearch(): { h: IViewsHarness; descriptor: IViewDescriptor } {
        const h = makeViewsHarness();
        const descriptor = viewWithBody("search.results", "search", 10, {
            requiresWorkspaceFolder: true,
            placeholder: WELCOME,
        });
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(descriptor);
        h.service.attachContainer("search");
        return { h, descriptor };
    }

    it("без папки тело перекрыто welcome, хотя тело уже построено", () => {
        const { h, descriptor } = makeSearch();

        expect(placeholderOf(h, "search", "search.results")).toBeInstanceOf(ViewWelcomeElement);
        expect(bodyShown(h, "search", descriptor)).toBe(false);
    });

    it("открыли папку — welcome уходит, на экране тело секции", () => {
        const { h, descriptor } = makeSearch();

        h.workspace.setWorkspaceFolder("/tmp/some-project");

        expect(placeholderOf(h, "search", "search.results")).toBeNull();
        expect(bodyShown(h, "search", descriptor)).toBe(true);
    });

    it("секция без флага папкой не гейтится — её тело видно и в пустом окне", () => {
        const h = makeViewsHarness();
        const descriptor = viewWithBody("ext.list", "ext", 10);
        h.service.registerContainer({ id: "ext", title: "EXTENSIONS", location: "sidebar" });
        h.service.registerView(descriptor);
        h.service.attachContainer("ext");

        expect(placeholderOf(h, "ext", "ext.list")).toBeNull();
        expect(bodyShown(h, "ext", descriptor)).toBe(true);

        // Открытие папки её состояние не меняет: гейта нет — нечего обновлять.
        h.workspace.setWorkspaceFolder("/tmp/some-project");
        expect(bodyShown(h, "ext", descriptor)).toBe(true);
    });

    it("смена папки не показывает обратно скрытую пользователем секцию", () => {
        const h = makeViewsHarness();
        const changes = viewWithBody("scm.changes", "scm", 10, {
            requiresWorkspaceFolder: true,
            placeholder: WELCOME,
        });
        h.service.registerContainer({ id: "scm", title: "SCM", location: "sidebar" });
        h.service.registerView(changes);
        h.service.registerView(
            view("scm.graph", "scm", 20, { requiresWorkspaceFolder: true, placeholder: "No folder opened." }),
        );
        h.service.attachContainer("scm");
        h.service.setViewVisible("scm.graph", false);

        h.workspace.setWorkspaceFolder("/tmp/some-project");

        expect(h.paneView("scm").getPaneIds()).toEqual(["scm.changes"]);
        expect(bodyShown(h, "scm", changes)).toBe(true);
    });

    it("setViewBody на погашенной секции запоминает тело, но на экране остаётся welcome", () => {
        const { h } = makeSearch();
        const next = new FillerElement();
        next.id = "search-next";

        h.service.setViewBody("search.results", next);

        expect(placeholderOf(h, "search", "search.results")).toBeInstanceOf(ViewWelcomeElement);
        h.workspace.setWorkspaceFolder("/tmp/some-project");
        expect(h.paneView("search").querySelector("#search-next")).toBe(next);
    });

    it("погашенная секция в контейнере, который ещё не приаттачен, папку переживает молча", () => {
        const h = makeViewsHarness();
        h.service.registerView(
            view("later.view", "later", 10, { requiresWorkspaceFolder: true, placeholder: WELCOME }),
        );

        expect(() => {
            h.workspace.setWorkspaceFolder("/tmp/some-project");
        }).not.toThrow();
    });
});

describe("ViewsService: фокус на пустом состоянии", () => {
    it("фокус контейнера уходит на кнопку welcome, а не в невидимое тело", () => {
        const h = makeViewsHarness();
        let bodyFocused = 0;
        h.service.registerContainer({ id: "search", title: "SEARCH", location: "sidebar" });
        h.service.registerView(
            view("search.results", "search", 10, {
                requiresWorkspaceFolder: true,
                placeholder: WELCOME,
                focus: () => {
                    bodyFocused++;
                },
            }),
        );
        h.service.attachContainer("search");

        h.service.focusContainer("search");
        expect(bodyFocused).toBe(0);

        h.workspace.setWorkspaceFolder("/tmp/some-project");
        h.service.focusContainer("search");
        expect(bodyFocused).toBe(1);
    });

    it("пустое состояние без кнопок фокус не перехватывает — он уходит в секцию", () => {
        const h = makeViewsHarness();
        let bodyFocused = 0;
        h.service.registerContainer({ id: "out", title: "OUTPUT", location: "sidebar" });
        h.service.registerView(
            view("out.channel", "out", 10, {
                body: null,
                placeholder: "No output yet.",
                focus: () => {
                    bodyFocused++;
                },
            }),
        );
        h.service.attachContainer("out");

        h.service.focusContainer("out");

        expect(bodyFocused).toBe(1);
    });
});
