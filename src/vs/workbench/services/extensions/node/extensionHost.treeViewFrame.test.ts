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

const VIEW = "test.rootFail";

// The real subprocess behind the host's tree, checked in the frame: what the user sees after the extension misbehaves.
describe("ExtensionHost — extension tree view in the frame", () => {
    let harness: IExtensionHarness | undefined;

    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    async function setup() {
        const h = makeViewsHarness();
        h.service.registerContainer({ id: "sb", title: "SB", location: "sidebar", order: 0, isDefault: true });
        h.service.registerView(testView(VIEW, "sb", 0, { body: null, placeholder: "nothing yet" }));
        h.commands.register(`${VIEW}.focus`, () => undefined);
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
            configuration: new InMemoryConfigurationService(new ConfigurationRegistry()),
            workspace: h.workspace,
            colors: { resolve: () => undefined },
            notifyError: () => undefined,
            logger,
        });
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.rootFail", "treeViewRootFailureExtension.cjs")],
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
        const { harness: ext, frame, errors } = await setup();
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
});
