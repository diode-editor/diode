import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { Emitter } from "../../../base/common/event.ts";
import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { IViewsHarness } from "../../browser/parts/views/viewsService.testUtils.ts";
import { makeViewsHarness, paneTitles, testView } from "../../browser/parts/views/viewsService.testUtils.ts";
import { ViewWelcomeElement } from "../../browser/parts/views/viewWelcomeElement.ts";

import { bindViewActivation, registerExtensionViews } from "./viewsExtensionPoint.ts";

function extension(id: string, contributes: IExtensionManifest["contributes"], displayName?: string): IExtension {
    return {
        id,
        manifest: { name: id, publisher: "test", version: "0.0.1", displayName, contributes },
        location: `UserExtensions/${id}/`,
        isBuiltin: false,
    } as IExtension;
}

interface ISetup {
    readonly h: IViewsHarness;
    readonly log: string[];
    readonly toasts: string[];
    dispose(): void;
}

/** Built-in Explorer and Source Control are registered first, as the workbench does before `startWorkbench`. */
function setup(extensions: readonly IExtension[], options: { logger?: boolean } = {}): ISetup {
    const h = makeViewsHarness();
    h.service.registerContainer({ id: "explorer", title: "EXPLORER", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView("explorer.files", "explorer", 0));
    h.service.registerContainer({ id: "scm", title: "SOURCE CONTROL", location: "sidebar", order: 2 });
    h.service.registerView(testView("scm.changes", "scm", 0));
    const log: string[] = [];
    const toasts: string[] = [];
    const record = (level: string) => (line: string) => log.push(`${level}: ${line}`);
    const logger = { info: record("info"), warn: record("warn"), error: record("error") } as unknown as ILogger;
    const disposable = registerExtensionViews(extensions, {
        views: h.service,
        commands: h.commands,
        contextKeys: h.contextKeys,
        notify: (message) => toasts.push(message),
        logger: options.logger === false ? undefined : logger,
    });
    h.service.attachRegisteredContainers();
    return {
        h,
        log,
        toasts,
        dispose: () => {
            disposable.dispose();
        },
    };
}

const TERRAFORM_LIKE = extension(
    "acme.infra",
    {
        viewsContainers: {
            activitybar: [
                { id: "infra", title: "Acme Infra", icon: "media/infra.svg" },
                { id: "infra-cloud", title: "Infra Cloud", icon: "$(cloud)" },
            ],
            panel: [{ id: "infra-panel", title: "Infra Runs", icon: "media/runs.svg" }],
        },
        views: {
            infra: [
                { id: "infra.providers", name: "Providers" },
                { id: "infra.modules", name: "Module Calls", visibility: "collapsed" },
            ],
            "infra-cloud": [{ id: "infra.workspaces", name: "Workspaces" }],
            "infra-panel": [
                { id: "infra.plan", name: "Plan" },
                { id: "infra.apply", name: "Apply", when: "infra.viewingApply" },
            ],
        },
    },
    "Acme Infra",
);

function locations(h: IViewsHarness): string[] {
    return h.service.getViewContainers().map((c) => `${c.location}:${c.id}:${c.title}`);
}

describe("registerExtensionViews — containers", () => {
    it("activitybar containers join the sidebar after the built-in ones, panel ones join the panel", () => {
        const { h, log } = setup([TERRAFORM_LIKE]);
        expect(locations(h)).toEqual([
            "sidebar:explorer:EXPLORER",
            "sidebar:scm:SOURCE CONTROL",
            "sidebar:workbench.view.extension.infra:ACME INFRA",
            "sidebar:workbench.view.extension.infra-cloud:INFRA CLOUD",
            "panel:workbench.view.extension.infra-panel:INFRA RUNS",
        ]);
        expect(h.viewlets).toContain("workbench.view.extension.infra");
        // The switcher shows the author's casing; the header shows it upper-cased, like the built-ins.
        expect(h.service.getViewContainers().map((c) => c.label)).toEqual([
            undefined,
            undefined,
            "Acme Infra",
            "Infra Cloud",
            "Infra Runs",
        ]);
        expect(log).toEqual([]);
    });

    it("the sections of an own container follow manifest order, with names upper-cased and `collapsed` applied", () => {
        const { h } = setup([TERRAFORM_LIKE]);
        const paneView = h.paneView("workbench.view.extension.infra");
        expect(paneTitles(paneView)).toEqual(["PROVIDERS", "MODULE CALLS"]);
        expect(paneView.isCollapsed("infra.providers")).toBe(false);
        expect(paneView.isCollapsed("infra.modules")).toBe(true);
    });

    it("a section shows the placeholder: the tree itself is not rendered", () => {
        const { h } = setup([TERRAFORM_LIKE]);
        const placeholder = h
            .root("workbench.view.extension.infra-cloud")
            .querySelector("#viewPlaceholder-infra-workspaces");
        expect(placeholder).toBeInstanceOf(ViewWelcomeElement);
        // Wraps in a narrow sidebar instead of being clipped.
        const screen = renderElement(placeholder as ViewWelcomeElement, 24, 3).screenToString();
        expect(screen.replace(/\s+/g, " ").trim()).toBe("Extension tree views are not rendered yet.");
    });

    it("`workbench.view.extension.<id>` opens the container and shows up in the palette under View", () => {
        const { h } = setup([TERRAFORM_LIKE]);
        expect(h.commands.listCommands()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "workbench.view.extension.infra",
                    title: "Show Acme Infra",
                    category: "View",
                }),
            ]),
        );
        h.commands.execute("workbench.view.extension.infra");
        expect(h.shownViewlets.at(-1)).toEqual({ id: "workbench.view.extension.infra", reveal: true });
    });

    it("secondarySidebar goes to the auxiliary bar; an unknown location is a warning", () => {
        const { h, log } = setup([
            extension("acme.side", {
                viewsContainers: {
                    secondarySidebar: [{ id: "side", title: "Side", icon: "x.svg" }],
                    remote: [{ id: "rem", title: "Remote", icon: "x.svg" }],
                },
                views: { side: [{ id: "side.view", name: "Side View" }] },
            }),
        ]);
        expect(locations(h)).toContain("auxiliarybar:workbench.view.extension.side:SIDE");
        expect(log).toEqual(['warn: acme.side: views container location "remote" is not supported, skipped']);
    });

    it("one invalid container rejects the whole location list, as upstream", () => {
        const bad = (descriptor: unknown) =>
            extension("acme.bad", {
                viewsContainers: { activitybar: [{ id: "ok", title: "Ok", icon: "i" }, descriptor] },
            } as never);
        const cases: [unknown, string][] = [
            [{ id: "has space", title: "T", icon: "i" }, "property `id` is mandatory"],
            [{ id: "", title: "T", icon: "i" }, "property `id` is mandatory"],
            [{ title: "T", icon: "i" }, "property `id` is mandatory"],
            [{ id: "x", icon: "i" }, "property `title` is mandatory"],
            [{ id: "x", title: "T" }, "property `icon` is mandatory"],
        ];
        for (const [descriptor, message] of cases) {
            const { h, log } = setup([bad(descriptor)]);
            expect(h.service.getViewContainerLocation("workbench.view.extension.ok")).toBeNull();
            expect(log).toHaveLength(1);
            expect(log[0]).toContain(`error: acme.bad: viewsContainers.activitybar: ${message}`);
        }
        const { log } = setup([extension("acme.bad", { viewsContainers: { panel: "nope" } } as never)]);
        expect(log).toEqual(["error: acme.bad: viewsContainers.panel: views containers must be an array"]);
    });

    it("a blank title falls back to the id; a container id taken by another extension is an error", () => {
        const { h, log } = setup([
            extension("acme.one", {
                viewsContainers: { activitybar: [{ id: "shared", title: "  ", icon: "i" }] },
                views: { shared: [{ id: "one.view" }] },
            }),
            extension("acme.two", { viewsContainers: { activitybar: [{ id: "shared", title: "Two", icon: "i" }] } }),
        ]);
        expect(locations(h)).toContain("sidebar:workbench.view.extension.shared:WORKBENCH.VIEW.EXTENSION.SHARED");
        expect(log).toEqual(['error: acme.two: views container "shared" is already registered']);
    });

    it("a container without views takes no place, like upstream `hideIfEmpty`", () => {
        const { h } = setup([
            extension("acme.empty", { viewsContainers: { activitybar: [{ id: "empty", title: "Empty", icon: "i" }] } }),
        ]);
        expect(locations(h)).toEqual(["sidebar:explorer:EXPLORER", "sidebar:scm:SOURCE CONTROL"]);
    });

    it("an existing command with the container id is not overridden", () => {
        const h = makeViewsHarness();
        const calls: string[] = [];
        h.commands.register("workbench.view.extension.infra", () => calls.push("own"));
        registerExtensionViews([TERRAFORM_LIKE], {
            views: h.service,
            commands: h.commands,
            contextKeys: h.contextKeys,
            notify: () => {},
        });
        h.commands.execute("workbench.view.extension.infra");
        expect(calls).toEqual(["own"]);
    });
});

describe("registerExtensionViews — views", () => {
    it("views in Explorer and Source Control come after the built-in sections, collapsed", () => {
        const { h } = setup([
            extension("acme.go", {
                views: {
                    explorer: [{ id: "go.explorer", name: "go" }],
                    scm: [{ id: "go.scm", name: "Go SCM", visibility: "visible" }],
                },
            }),
        ]);
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER.FILES", "GO"]);
        expect(h.paneView("explorer").isCollapsed("go.explorer")).toBe(true);
        expect(paneTitles(h.paneView("scm"))).toEqual(["SCM.CHANGES", "GO SCM"]);
        expect(h.paneView("scm").isCollapsed("go.scm")).toBe(true);
    });

    it("an unknown container key sends the views to Explorer with a warning; the name falls back to the id", () => {
        const { h, log } = setup([extension("acme.test", { views: { test: [{ id: "acme.profiles", name: "" }] } })]);
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER.FILES", "ACME.PROFILES"]);
        expect(log).toEqual(['warn: acme.test: view container "test" does not exist, its views are added to Explorer']);
    });

    it("a view of a foreign extension container goes after the owner's sections", () => {
        const { h } = setup([
            TERRAFORM_LIKE,
            extension("acme.addon", { views: { infra: [{ id: "addon.view", name: "Addon" }] } }),
        ]);
        expect(paneTitles(h.paneView("workbench.view.extension.infra"))).toEqual([
            "PROVIDERS",
            "MODULE CALLS",
            "ADDON",
        ]);
    });

    it("a webview view is not registered; its `.focus` explains why, and a webview-only container stays hidden", () => {
        const { h, toasts } = setup([
            extension(
                "acme.chat",
                {
                    viewsContainers: { activitybar: [{ id: "chat", title: "Chat", icon: "i" }] },
                    views: { chat: [{ id: "acme.chatView", name: "Chat", type: "webview" }] },
                },
                "Acme Chat",
            ),
            extension("acme.bare", { views: { explorer: [{ id: "bare.web", type: "webview" }] } }),
        ]);
        expect(h.service.getViewContainerByViewId("acme.chatView")).toBeNull();
        expect(locations(h)).not.toContain("sidebar:workbench.view.extension.chat:CHAT");
        expect(h.commands.execute("acme.chatView.focus")).toBeUndefined();
        h.commands.execute("bare.web.focus");
        expect(toasts).toEqual([
            `Acme Chat: view "Chat" is a webview — webviews can't be shown in the terminal`,
            `acme.bare: view "bare.web" is a webview — webviews can't be shown in the terminal`,
        ]);
        // Focus commands stay out of the palette, as before.
        expect(h.commands.listCommands().map((c) => c.id)).not.toContain("acme.chatView.focus");
    });

    it("`<view>.focus` of a tree view opens its container and focuses the section header", () => {
        const { h } = setup([TERRAFORM_LIKE]);
        const app = TestApp.createWithContent(h.root("workbench.view.extension.infra"), new Size(30, 12));
        app.render();
        h.commands.execute("infra.modules.focus");
        expect(h.shownViewlets.at(-1)).toEqual({ id: "workbench.view.extension.infra", reveal: true });
        expect(app.focusedElement?.id).toBe("paneHeader-infra-modules");

        // A hidden section has no header to focus: the call leaves focus alone. Hiding rebuilds the
        // headers, so focus is put back first.
        h.service.setViewVisible("infra.providers", false);
        h.service.focusViewHeader("infra.modules");
        expect(app.focusedElement?.id).toBe("paneHeader-infra-modules");
        h.service.focusViewHeader("infra.providers");
        h.service.focusViewHeader("unknown.view");
        expect(app.focusedElement?.id).toBe("paneHeader-infra-modules");
    });

    it("rejected views: unknown type, a duplicate id, a list without ids, a non-list", () => {
        const { h, log } = setup([
            extension("acme.junk", {
                views: {
                    explorer: [
                        { id: "junk.tree", name: "Tree", type: "tree" },
                        { id: "junk.odd", type: "notebook" },
                        { id: "explorer.files" },
                        { id: "junk.tree" },
                    ],
                    scm: [{ id: "ok.but.rejected" }, { name: "no id" } as never],
                    broken: "not-a-list" as never,
                },
            }),
        ]);
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER.FILES", "TREE"]);
        expect(h.service.getViewContainerByViewId("ok.but.rejected")).toBeNull();
        expect(h.commands.has("junk.odd.focus")).toBe(false);
        expect(log).toEqual([
            'error: acme.junk: view "junk.odd" has unknown type "notebook"',
            'error: acme.junk: a view with id "explorer.files" is already registered',
            'error: acme.junk: a view with id "junk.tree" is already registered',
            "error: acme.junk: views.scm: property `id` is mandatory and must be a string",
            "error: acme.junk: views.broken: views must be an array",
        ]);
    });

    it("without a logger junk is skipped silently; dispose drops the commands", () => {
        const { h, dispose } = setup(
            [
                TERRAFORM_LIKE,
                extension("acme.junk", { viewsContainers: { remote: [] }, views: { nowhere: [{ id: "x" }] } }),
            ],
            { logger: false },
        );
        expect(h.commands.has("infra.providers.focus")).toBe(true);
        dispose();
        expect(h.commands.has("infra.providers.focus")).toBe(false);
        expect(h.commands.has("workbench.view.extension.infra")).toBe(false);
    });
});

describe("registerExtensionViews — `when`", () => {
    const GATED = extension("acme.go", {
        viewsContainers: { activitybar: [{ id: "go", title: "Go", icon: "i" }] },
        views: {
            explorer: [{ id: "go.explorer", name: "go", when: "go.showExplorer" }],
            go: [{ id: "go.profiles", name: "Profiles", when: "go.hasProfiles && !config.go.hide" }],
        },
    });

    it("a view whose clause is false takes no place: no section, no container, `.focus` does nothing", () => {
        const { h } = setup([GATED]);
        // A single section merges with the container and carries its title.
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER"]);
        expect(h.service.getViewContainers().map((c) => c.id)).not.toContain("workbench.view.extension.go");
        const shownBefore = h.shownViewlets.length;
        h.commands.execute("go.profiles.focus");
        expect(h.shownViewlets.length).toBe(shownBefore);
    });

    it("the view comes and goes with its context keys, and its container with it", async () => {
        const { h } = setup([GATED]);
        h.contextKeys.setRaw("go.showExplorer", true);
        h.contextKeys.setRaw("go.hasProfiles", true);
        await Promise.resolve();
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER.FILES", "GO"]);
        expect(h.service.getViewContainerByViewId("go.profiles")).toBe("workbench.view.extension.go");

        h.contextKeys.setRaw("go.hasProfiles", false);
        await Promise.resolve();
        expect(h.service.getViewContainers().map((c) => c.id)).not.toContain("workbench.view.extension.go");
        expect(h.service.getViewContainerByViewId("go.profiles")).toBeNull();
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER.FILES", "GO"]);

        h.contextKeys.setRaw("go.showExplorer", false);
        await Promise.resolve();
        expect(paneTitles(h.paneView("explorer"))).toEqual(["EXPLORER"]);
    });

    it("a clause that holds at startup registers the view right away; blank clauses count as none", () => {
        const h = makeViewsHarness();
        h.contextKeys.setRaw("go.showExplorer", true);
        registerExtensionViews(
            [
                GATED,
                extension("acme.blank", { views: { explorer: [{ id: "blank.view", name: "Blank", when: "  " }] } }),
            ],
            { views: h.service, commands: h.commands, contextKeys: h.contextKeys, notify: () => {} },
        );
        expect(h.service.getViewContainerByViewId("go.explorer")).toBe("explorer");
        expect(h.service.getViewContainerByViewId("blank.view")).toBe("explorer");
        expect(h.service.getViewContainerByViewId("go.profiles")).toBeNull();
    });

    it("dispose stops following the context keys", async () => {
        const { h, dispose } = setup([GATED]);
        dispose();
        h.contextKeys.setRaw("go.showExplorer", true);
        await Promise.resolve();
        expect(h.service.getViewContainerByViewId("go.explorer")).toBeNull();
    });
});

describe("bindViewActivation", () => {
    it("every shown view activates `onView:<id>`, built-in ones included", () => {
        const { h } = setup([TERRAFORM_LIKE]);
        const events: string[] = [];
        bindViewActivation(h.service.onDidShowView, (event) => events.push(event));
        h.showViewlet("workbench.view.extension.infra");
        h.showViewlet("explorer");
        expect(events).toEqual(["onView:infra.providers", "onView:infra.modules", "onView:explorer.files"]);
    });

    it("dispose stops the activation", () => {
        const emitter = new Emitter<string>();
        const events: string[] = [];
        const binding = bindViewActivation(emitter.event, (event) => events.push(event));
        emitter.fire("a");
        binding.dispose();
        emitter.fire("b");
        expect(events).toEqual(["onView:a"]);
    });
});
