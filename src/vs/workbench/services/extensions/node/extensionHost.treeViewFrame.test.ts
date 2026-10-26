import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import { ExtensionTreeViewsAdapter } from "../../../api/browser/extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "../../../api/browser/extensionViewWelcomes.ts";
import { makeViewsHarness, testView } from "../../../browser/parts/views/viewsService.testUtils.ts";

// The real subprocess behind the host's tree, checked in the frame: what the user sees after the extension misbehaves.
describe("ExtensionHost — extension tree view in the frame", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup(view: string, fixture: string) {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
        h.service.registerView(testView(view, "sb", 0, { body: null, placeholder: "nothing yet" }));
        h.commands.register(`${view}.focus`, () => undefined);
        h.service.attachRegisteredContainers();
        h.showViewlet("sb");
        const errors: string[] = [];
        const logger = {
            warn: () => undefined,
            error: (message: string) => errors.push(message),
        } as unknown as ILogger;
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
            configuration: new InMemoryConfigurationService(new ConfigurationRegistry()),
            workspace: h.workspace,
            colors: { resolve: () => undefined },
            notifyError: () => undefined,
            logger,
        });
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture(view, fixture)],
            treeViewsSink: adapter,
        });
        const app = TestApp.createWithContent(h.root("sb"), new Size(40, 12));
        const frame = (): string => {
            app.render();
            return app.backend.screenToString();
        };
        return { harness, frame, errors };
    }

    it("a rejected root reread keeps the rows the tree had, the children of an expanded package included", async () => {
        const { harness: ext, frame, errors } = await setup("test.rootFail", "treeViewRootFailureExtension.cjs");
        await waitUntil("the expanded package", () => frame().includes("app-test"));

        await ext.commandRegistry.execute("test.rootFail.set", true);
        await ext.commandRegistry.execute("test.rootFail.fire");
        await waitUntil("the failed reread in Output", () => errors.some((line) => line.includes("root rejected")));
        await settle(100);

        const text = frame();
        expect(text).toContain("//app");
        expect(text).toContain("//lib");
        expect(text).toContain("app-main");
        expect(text).toContain("app-test");
    });

    it("Expand and Collapse rebuilt with numeric ids, as Todo Tree: every folder opens with its rows, then closes", async () => {
        const { harness: ext, frame } = await setup("test.rebuild", "treeViewRebuildExtension.cjs");
        // Labels without the indent and the chevron.
        const rows = (): string[] =>
            frame()
                .split("\n")
                .slice(1)
                .map((line) => line.replace(/^[^a-z]+/, "").trimEnd())
                .filter((line) => line !== "");
        await waitUntil("the collapsed workspace", () => frame().includes("workspace"));
        expect(rows()).toEqual(["workspace", "notes"]);

        await ext.commandRegistry.execute("test.rebuild.expand");
        await waitUntil("the rows of every folder", () => frame().includes("c.py"));
        expect(rows()).toEqual(["workspace", "src", "a.ts", "lib", "c.py", "notes"]);

        await ext.commandRegistry.execute("test.rebuild.collapse");
        await waitUntil("the folders closed", () => !frame().includes("src"));
        expect(rows()).toEqual(["workspace", "notes"]);
    });

    it("a row fired as Expanded under the same id keeps the state it has, as upstream, with no blank rows", async () => {
        const { harness: ext, frame } = await setup("test.rebuild", "treeViewRebuildExtension.cjs");
        await waitUntil("the collapsed notes", () => frame().includes("notes"));
        const before = frame();

        await ext.commandRegistry.execute("test.rebuild.flipNotes");
        await settle(100);
        expect(frame()).toBe(before);
    });
});
