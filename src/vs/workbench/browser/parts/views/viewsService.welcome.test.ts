import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import type { IViewsHarness } from "./viewsService.testUtils.ts";
import { makeViewsHarness, testView as view } from "./viewsService.testUtils.ts";
import type { IViewDescriptor } from "./viewsService.ts";
import type { IViewWelcomeBlock } from "./viewWelcomeElement.ts";
import { ViewWelcomeElement } from "./viewWelcomeElement.ts";

const WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "You have not yet opened a folder." },
    { kind: "text", text: "" },
    { kind: "button", label: "Open Folder", command: "openFolder" },
];

function placeholderOf(h: IViewsHarness, containerId: string, viewId: string): TUIElement | null {
    return h.paneView(containerId).querySelector(`#viewPlaceholder-${viewId.replaceAll(".", "-")}`);
}

/**
 * A descriptor with a body whose id works as a selector: `testView` names the body
 * `<id>-body`, and the view id has a dot that `querySelector` can't parse.
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

function bodyShown(h: IViewsHarness, containerId: string, descriptor: IViewDescriptor): boolean {
    const body = descriptor.body;
    if (body === null) throw new Error("bodyShown: descriptor without a body");
    return h.paneView(containerId).querySelector(`#${String(body.id)}`) === body;
}

describe("ViewsService: interactive empty state (viewsWelcome)", () => {
    it("a block placeholder renders as a welcome control, a string one as a plain hint", () => {
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

    it("a welcome button runs the declared command through the command registry", () => {
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

    it("a section without a placeholder gets no welcome: the empty state stays plain", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar" });
        h.service.registerView(view("sb.empty", "sb", 10, { body: null }));
        h.service.attachContainer("sb");

        const flat = placeholderOf(h, "sb", "sb.empty");
        expect(flat).toBeInstanceOf(TextLabelElement);
        expect((flat as TextLabelElement).getText()).toBe("");
    });
});

describe("ViewsService: section requires an open folder", () => {
    /** Search in miniature: the body is built up front, but without a folder there is nowhere to search. */
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

    it("without a folder the body is covered by welcome, although the body is already built", () => {
        const { h, descriptor } = makeSearch();

        expect(placeholderOf(h, "search", "search.results")).toBeInstanceOf(ViewWelcomeElement);
        expect(bodyShown(h, "search", descriptor)).toBe(false);
    });

    it("opening a folder removes welcome, the section body is on screen", () => {
        const { h, descriptor } = makeSearch();

        h.workspace.setWorkspaceFolder("/tmp/some-project");

        expect(placeholderOf(h, "search", "search.results")).toBeNull();
        expect(bodyShown(h, "search", descriptor)).toBe(true);
    });

    it("a section without the flag is not gated by a folder: its body is visible in an empty window too", () => {
        const h = makeViewsHarness();
        const descriptor = viewWithBody("ext.list", "ext", 10);
        h.service.registerContainer({ id: "ext", title: "EXTENSIONS", location: "sidebar" });
        h.service.registerView(descriptor);
        h.service.attachContainer("ext");

        expect(placeholderOf(h, "ext", "ext.list")).toBeNull();
        expect(bodyShown(h, "ext", descriptor)).toBe(true);

        // Opening a folder doesn't change its state: there's no gate, nothing to refresh.
        h.workspace.setWorkspaceFolder("/tmp/some-project");
        expect(bodyShown(h, "ext", descriptor)).toBe(true);
    });

    it("changing the folder does not re-show a section hidden by the user", () => {
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

    it("setViewBody on a gated section remembers the body, but welcome stays on screen", () => {
        const { h } = makeSearch();
        const next = new FillerElement();
        next.id = "search-next";

        h.service.setViewBody("search.results", next);

        expect(placeholderOf(h, "search", "search.results")).toBeInstanceOf(ViewWelcomeElement);
        h.workspace.setWorkspaceFolder("/tmp/some-project");
        expect(h.paneView("search").querySelector("#search-next")).toBe(next);
    });

    it("a gated section in a not yet attached container survives a folder change silently", () => {
        const h = makeViewsHarness();
        h.service.registerView(
            view("later.view", "later", 10, { requiresWorkspaceFolder: true, placeholder: WELCOME }),
        );

        expect(() => {
            h.workspace.setWorkspaceFolder("/tmp/some-project");
        }).not.toThrow();
    });
});

describe("ViewsService: focus on the empty state", () => {
    it("container focus goes to the welcome button, not into the invisible body", () => {
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

    it("an empty state without buttons does not take focus: it goes into the section", () => {
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
