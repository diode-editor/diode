import { Size } from "@tuidom/core/common/geometryPromitives";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import { makeViewsHarness, testView } from "../../browser/parts/views/viewsService.testUtils.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";
import type { IWireTreeItem } from "../common/treeViewWireTypes.ts";

import { ExtensionTreeViewsAdapter } from "./extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "./extensionViewWelcomes.ts";
import type { IViewWelcomeContent } from "./viewsWelcomeExtensionPoint.ts";

const VIEW = "terraform.providers";

const NO_FILES =
    "There are no open Terraform files. Please open a Terraform configuration file to see installed providers.";
const NO_PROVIDERS =
    "There are no installed providers found for the current open file.\n[Learn more about providers](https://example.invalid/providers)";

/** The shape of Terraform's own entries: keys it sets through `setContext` from `getChildren`. */
const TERRAFORM: readonly IViewWelcomeContent[] = [
    { contents: NO_FILES, when: "!terraform.providers.documentOpened" },
    { contents: NO_PROVIDERS, when: "terraform.providers.documentOpened && terraform.providers.noProviders" },
];

function item(handle: string, label: string): IWireTreeItem {
    return { handle, label, collapsibleState: 0 };
}

function source(rows: { root: readonly IWireTreeItem[] }): IExtensionTreeDataSource & { requests: number } {
    const recorded = {
        requests: 0,
        getChildren: () => {
            recorded.requests++;
            return Promise.resolve(rows.root);
        },
        executeCommand: () => Promise.resolve(),
        setVisible: () => undefined,
        setExpanded: () => undefined,
        setSelection: () => undefined,
    };
    return recorded;
}

function setup(options: { settings?: Record<string, unknown>; registered?: boolean } = {}) {
    const h = makeViewsHarness();
    const configuration = new InMemoryConfigurationService(new ConfigurationRegistry(), options.settings ?? {});
    const contextKeys = new ContextKeyService(configuration);
    h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
    h.service.registerView(testView("sb.files", "sb", 0));
    if (options.registered !== false) h.service.registerView(testView(VIEW, "sb", 1, { body: null }));
    h.commands.register(`${VIEW}.focus`, () => undefined);
    h.service.attachRegisteredContainers();
    h.showViewlet("sb");
    const opened: string[] = [];
    const ran: unknown[][] = [];
    h.commands.register("terraform.openSettingsJson", (...args: unknown[]) => {
        ran.push(args);
    });
    const welcomes = new ExtensionViewWelcomes(h.service, contextKeys, h.commands, {
        open: (url) => {
            opened.push(url);
            return Promise.resolve(true);
        },
    });
    const adapter = new ExtensionTreeViewsAdapter({
        views: h.service,
        welcomes,
        commands: h.commands,
        menus: h.menuRegistry,
        configuration,
        workspace: h.workspace,
        colors: { resolve: () => undefined },
        notifyError: () => undefined,
    });
    const app = TestApp.createWithContent(h.root("sb"), new Size(40, 14));
    const frame = (): string => {
        app.render();
        return app.backend.screenToString().replace(/\s+/g, " ");
    };
    return { h, welcomes, adapter, contextKeys, configuration, frame, app, opened, ran };
}

describe("ExtensionViewWelcomes — what the section shows", () => {
    it("with no tree registered, the entries whose `when` holds are shown, in manifest order", () => {
        const { welcomes, frame } = setup();
        welcomes.registerContents(
            new Map([
                [
                    VIEW,
                    [
                        { contents: "first", when: "true" },
                        { contents: "hidden", when: "false" },
                        { contents: "always" },
                    ],
                ],
            ]),
        );

        expect(frame()).toContain("first always");
        expect(frame()).not.toContain("hidden");
    });

    it("a view with no entries has no welcome; the welcome element is addressable by the view id", () => {
        const { welcomes } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "text" }]]]));

        expect(welcomes.getWelcome("other.view")).toBeNull();
        expect(welcomes.getWelcome(VIEW)!.id).toBe("viewWelcome-terraform-providers");
    });

    it("the last applicable entry going away removes the welcome", async () => {
        const { welcomes, contextKeys, frame } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "keyed text", when: "my.key" }]]]));
        contextKeys.setRaw("my.key", true);
        await flushMicrotasks();
        expect(frame()).toContain("keyed text");

        contextKeys.setRaw("my.key", false);
        await flushMicrotasks();
        expect(welcomes.getWelcome(VIEW)).toBeNull();
        expect(frame()).not.toContain("keyed text");
    });

    it("a replaced or removed tree is no longer listened to", () => {
        const { welcomes } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "text" }]]]));
        let listening = 0;
        const tree = {
            view: new ButtonElement("tree"),
            shouldShowWelcome: () => true,
            onDidChangeWelcomeState: () => {
                listening++;
                return {
                    dispose: () => {
                        listening--;
                    },
                };
            },
        };
        welcomes.setTree(VIEW, tree);
        expect(listening).toBe(1);

        welcomes.setTree(VIEW, null);
        expect(listening).toBe(0);
    });

    it("no entry applies — the section stays empty", () => {
        const { h, welcomes, frame } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "hidden", when: "false" }]]]));

        expect(welcomes.getWelcome(VIEW)).toBeNull();
        expect(frame()).not.toContain("hidden");
        expect(h.paneView("sb").getPaneIds()).toContain(VIEW);
    });

    it("`default` is shown only while no other entry applies", async () => {
        const { welcomes, contextKeys, frame } = setup();
        welcomes.registerContents(
            new Map([
                [
                    VIEW,
                    [
                        { contents: "fallback text", when: "default" },
                        { contents: "keyed text", when: "my.key" },
                    ],
                ],
            ]),
        );
        expect(frame()).toContain("fallback text");

        contextKeys.setRaw("my.key", true);
        await flushMicrotasks();
        expect(frame()).toContain("keyed text");
        expect(frame()).not.toContain("fallback text");
    });

    it("the extension's setContext keys switch the text live (Terraform's Providers)", async () => {
        const { welcomes, contextKeys, frame } = setup();
        welcomes.registerContents(new Map([[VIEW, TERRAFORM]]));
        expect(frame()).toContain("There are no open Terraform files.");

        contextKeys.setRaw("terraform.providers.documentOpened", true);
        contextKeys.setRaw("terraform.providers.noProviders", true);
        await flushMicrotasks();
        expect(frame()).toContain("There are no installed providers found");
        expect(frame()).toContain("Learn more about providers");
        expect(frame()).not.toContain("no open Terraform files");
    });

    it("`config.*` follows the settings", async () => {
        const { welcomes, configuration, frame } = setup({ settings: { "tf.languageServer.enable": true } });
        welcomes.registerContents(
            new Map([
                [
                    VIEW,
                    [
                        {
                            contents:
                                "The language server is off.\n[Open Settings](command:terraform.openSettingsJson)",
                            when: "!config.tf.languageServer.enable",
                        },
                    ],
                ],
            ]),
        );
        expect(frame()).not.toContain("language server is off");

        await configuration.updateValue("tf.languageServer.enable", false);
        await flushMicrotasks();
        expect(frame()).toContain("The language server is off. [ Open Settings ]");
    });

    it("a view whose `when` is false gets the welcome when it shows", () => {
        const { h, welcomes, frame } = setup({ registered: false });
        welcomes.registerContents(new Map([[VIEW, [{ contents: "late view text" }]]]));
        expect(frame()).not.toContain("late view text");

        h.service.registerView(testView(VIEW, "sb", 1, { body: null }));
        expect(frame()).toContain("late view text");
    });

    it("entries for a view no extension contributed are never shown and break nothing", () => {
        const { welcomes, frame } = setup();
        welcomes.registerContents(new Map([["explorer", [{ contents: "foreign text" }]]]));

        expect(frame()).not.toContain("foreign text");
    });
});

describe("ExtensionViewWelcomes — welcome against the tree", () => {
    it("an empty root shows the welcome; rows replace it, an empty reread brings it back", async () => {
        const { adapter, welcomes, frame } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "nothing to list" }]]]));
        const rows = { root: [] as readonly IWireTreeItem[] };
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source(rows));
        await flushMicrotasks(10);
        expect(frame()).toContain("nothing to list");

        rows.root = [item("a", "alpha")];
        await adapter.refresh(VIEW, undefined);
        await flushMicrotasks(10);
        expect(frame()).toContain("alpha");
        expect(frame()).not.toContain("nothing to list");

        rows.root = [];
        await adapter.refresh(VIEW, undefined);
        await flushMicrotasks(10);
        expect(frame()).toContain("nothing to list");
    });

    it("an empty tree with no applicable entry shows the (empty) tree", async () => {
        const { h, adapter, welcomes, frame } = setup();
        const bodies: unknown[] = [];
        const setViewBody = h.service.setViewBody.bind(h.service);
        h.service.setViewBody = (viewId, body) => {
            bodies.push(body);
            setViewBody(viewId, body);
        };
        welcomes.registerContents(new Map([[VIEW, [{ contents: "keyed", when: "nope" }]]]));
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source({ root: [] }));
        await flushMicrotasks(10);
        expect(frame()).not.toContain("keyed");
        // The tree element itself, not the empty state.
        expect(bodies.at(-1)).not.toBeNull();
    });

    it("a TreeView.message hides the welcome; clearing it brings the welcome back", async () => {
        const { adapter, welcomes, frame } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "nothing to list" }]]]));
        adapter.register({ viewId: VIEW, showCollapseAll: false, canSelectMany: false }, source({ root: [] }));
        await flushMicrotasks(10);

        adapter.setMessage(VIEW, "Loading providers");
        expect(frame()).toContain("Loading providers");
        expect(frame()).not.toContain("nothing to list");

        adapter.setMessage(VIEW, "");
        expect(frame()).toContain("nothing to list");
    });

    it("the tree going away (extension host restart) shows the welcome again", async () => {
        const { adapter, welcomes, frame } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "nothing to list" }]]]));
        adapter.register(
            { viewId: VIEW, showCollapseAll: false, canSelectMany: false },
            source({ root: [item("a", "alpha")] }),
        );
        await flushMicrotasks(10);
        expect(frame()).toContain("alpha");

        adapter.unregister(VIEW);
        expect(frame()).toContain("nothing to list");
        expect(frame()).not.toContain("alpha");
    });

    it("a reread with the same result keeps the tree element: the frame does not blink to the welcome", async () => {
        const { h, adapter, welcomes } = setup();
        welcomes.registerContents(new Map([[VIEW, [{ contents: "nothing to list" }]]]));
        adapter.register(
            { viewId: VIEW, showCollapseAll: false, canSelectMany: false },
            source({ root: [item("a", "alpha")] }),
        );
        await flushMicrotasks(10);
        const tree = adapter.getTree(VIEW)!.view;
        const bodies: unknown[] = [];
        const setViewBody = h.service.setViewBody.bind(h.service);
        h.service.setViewBody = (viewId, body) => {
            bodies.push(body);
            setViewBody(viewId, body);
        };

        const refresh = adapter.refresh(VIEW, undefined);
        expect(bodies.every((body) => body === tree)).toBe(true);
        await refresh;
        await flushMicrotasks(10);
        expect(bodies.every((body) => body === tree)).toBe(true);
    });

    it("a context change that leaves the same entries shown keeps the welcome element and its focus", async () => {
        const { app, welcomes, contextKeys } = setup();
        welcomes.registerContents(
            new Map([[VIEW, [{ contents: "[Open Settings](command:terraform.openSettingsJson)" }]]]),
        );
        const welcome = welcomes.getWelcome(VIEW)!;
        welcome.focusFirstButton();
        const focused = app.focusedElement;

        contextKeys.setRaw("unrelated", 1);
        await flushMicrotasks();
        expect(welcomes.getWelcome(VIEW)).toBe(welcome);
        expect(app.focusedElement).toBe(focused);
    });
});

describe("ExtensionViewWelcomes — buttons, links, enablement, focus", () => {
    it("a command button runs the command with its JSON arguments", () => {
        const { welcomes, ran, app } = setup();
        welcomes.registerContents(
            new Map([[VIEW, [{ contents: "[Open Settings](command:terraform.openSettingsJson?%5B%22a%22%2C2%5D)" }]]]),
        );
        app.render();
        welcomes.getWelcome(VIEW)!.focusFirstButton();
        app.sendKey("Enter");

        expect(ran).toEqual([["a", 2]]);
    });

    it("http(s) links open outside; a file: link does nothing, even with `https:` inside", () => {
        const { welcomes, opened, ran, app } = setup();
        welcomes.registerContents(
            new Map([
                [
                    VIEW,
                    [
                        {
                            contents:
                                "[Docs](https://example.invalid/docs)\n[Plain](http://example.invalid/plain)\n[Local](file:///tmp/https:a.tf)",
                        },
                    ],
                ],
            ]),
        );
        app.render();
        const buttons = welcomes
            .getWelcome(VIEW)!
            .getChildren()
            .filter((child) => child instanceof ButtonElement);
        for (const button of buttons) button.onActivate?.();

        expect(opened).toEqual(["https://example.invalid/docs", "http://example.invalid/plain"]);
        expect(ran).toEqual([]);
    });

    it("enablement follows the context live", async () => {
        const { welcomes, contextKeys, ran, app } = setup();
        welcomes.registerContents(
            new Map([
                [VIEW, [{ contents: "[Open Settings](command:terraform.openSettingsJson)", enablement: "tf.ready" }]],
            ]),
        );
        app.render();
        const welcome = welcomes.getWelcome(VIEW)!;
        expect(welcome.focusFirstButton()).toBe(false);

        contextKeys.setRaw("tf.ready", true);
        await flushMicrotasks();
        expect(welcome.focusFirstButton()).toBe(true);
        app.sendKey("Enter");
        expect(ran).toEqual([[]]);
    });

    it("<view>.focus (openView with focus) lands on the first button of the welcome", () => {
        const { h, welcomes, app } = setup();
        welcomes.registerContents(
            new Map([[VIEW, [{ contents: "Text first.\n[Open Settings](command:terraform.openSettingsJson)" }]]]),
        );
        app.render();
        h.service.openView(VIEW, true);

        expect((app.focusedElement as ButtonElement).getLabel()).toBe("Open Settings");
    });
});
