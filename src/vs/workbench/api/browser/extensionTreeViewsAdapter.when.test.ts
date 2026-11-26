import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import { makeViewsHarness, testView } from "../../browser/parts/views/viewsService.testUtils.ts";
import { SetContextCommandContribution } from "../../browser/setContextCommandContribution.ts";
import type { IExtensionTreeDataSource } from "../common/iExtensionTreeViewsSink.ts";

import { ExtensionTreeViewsAdapter } from "./extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "./extensionViewWelcomes.ts";
import { registerExtensionViews } from "./viewsExtensionPoint.ts";

// The stock clangd's AST view: `when: clangd.ast.hasData`, and the extension sets the key and calls
// `reveal(null)` without awaiting `setContext`. Upstream's context fires at once, so the view is there by then.
const CLANGD_LIKE = {
    id: "llvm.clangd-like",
    manifest: {
        name: "clangd-like",
        publisher: "llvm",
        version: "0.0.1",
        engines: { vscode: "*" },
        contributes: { views: { explorer: [{ id: "clangd.ast", name: "AST", when: "clangd.ast.hasData" }] } },
    },
    location: "UserExtensions/llvm.clangd-like/",
    isBuiltin: false,
} as IExtension;

function treeSource(): IExtensionTreeDataSource {
    return {
        getChildren: (parent) =>
            Promise.resolve(
                parent === undefined ? [{ handle: "r", label: "TranslationUnit", collapsibleState: 0 }] : [],
            ),
        executeCommand: () => Promise.resolve(),
        setVisible: () => undefined,
        setExpanded: () => undefined,
        setSelection: () => undefined,
    };
}

function setup() {
    const h = makeViewsHarness();
    h.service.registerContainer({
        id: "explorer",
        title: "EXPLORER",
        location: "sidebar",
        order: 0,
        isDefault: true,
    });
    h.service.registerView(testView("explorer.files", "explorer", 0));
    registerExtensionViews([CLANGD_LIKE], {
        views: h.service,
        commands: h.commands,
        contextKeys: h.contextKeys,
        notify: () => undefined,
    });
    h.service.attachRegisteredContainers();
    h.showViewlet("explorer");
    const adapter = new ExtensionTreeViewsAdapter({
        views: h.service,
        welcomes: new ExtensionViewWelcomes(h.service, new ContextKeyService(), h.commands, {
            open: () => Promise.resolve(false),
        }),
        commands: h.commands,
        menus: h.menuRegistry,
        menuService: h.menuService,
        contextMenu: h.contextMenu,
        contextKeys: h.contextKeys,
        configuration: new InMemoryConfigurationService(new ConfigurationRegistry(), {}),
        workspace: h.workspace,
        colors: { resolve: () => undefined },
        notifyError: () => undefined,
        logger: undefined,
    });
    adapter.register({ viewId: "clangd.ast", showCollapseAll: false, canSelectMany: false }, treeSource());
    const app = TestApp.createWithContent(h.root("explorer"), new Size(40, 12));
    new SetContextCommandContribution(h.commands, h.contextKeys);
    const frame = (): string => {
        app.render();
        return app.backend.screenToString();
    };
    return { h, adapter, frame };
}

describe("ExtensionTreeViewsAdapter — a view behind `when`", () => {
    it("reveal right after the setContext that shows the view opens and expands it", async () => {
        const { h, adapter, frame } = setup();

        h.commands.execute("setContext", "clangd.ast.hasData", true);
        await adapter.reveal({ viewId: "clangd.ast", parentChain: [], select: true, focus: false, expand: false });
        await flushMicrotasks(10);

        expect(frame()).toContain("TranslationUnit");
    });

    it("<view>.focus right after that setContext opens the view too", async () => {
        const { h, frame } = setup();

        h.commands.execute("setContext", "clangd.ast.hasData", true);
        h.commands.execute("clangd.ast.focus");
        await flushMicrotasks(10);

        expect(frame()).toContain("TranslationUnit");
    });
});
