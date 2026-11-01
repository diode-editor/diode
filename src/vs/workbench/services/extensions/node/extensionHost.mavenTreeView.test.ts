import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import {
    type IInstalledMaven,
    installMaven,
    MAVEN_ID,
    writeMavenProject,
} from "../../../../../TestUtils/mavenFixture.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { ExtensionTreeViewsAdapter } from "../../../api/browser/extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "../../../api/browser/extensionViewWelcomes.ts";
import { registerExtensionViews } from "../../../api/browser/viewsExtensionPoint.ts";
import { makeViewsHarness, paneTitles, testView } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";
import { registerExtensionMenus } from "../../extensions/common/extensionMenuContributor.ts";

// Stock vscjava.vscode-maven: the MAVEN section of the Explorer lists the projects of a multi-module workspace,
// and a project opens into Lifecycle with its goals. The contract is gated hermetically on a synthetic extension
// (extensionHost.treeView.test.ts); this suite checks the real extension lands where the user looks.

const CONTAINER = "explorer";
const VIEW = "mavenProjects";

let installed: IInstalledMaven;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock vscjava.vscode-maven tree view", () => {
    beforeAll(async () => {
        installed = await installMaven();
        expect(installed.registration.id).toBe(MAVEN_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "lists both modules of the workspace; a project opens into Lifecycle and its goals",
        { timeout: 120_000 },
        async () => {
            const views = makeViewsHarness();
            views.service.registerContainer({
                id: CONTAINER,
                title: "EXPLORER",
                location: "sidebar",
                order: 0,
                isDefault: true,
            });
            views.service.registerView(testView("explorer.files", CONTAINER, 0));
            const { registration } = installed;
            const viewsLog: string[] = [];
            const extension = {
                id: registration.id,
                manifest: registration.manifest as IExtensionManifest,
                location: "UserExtensions/maven/",
                isBuiltin: false,
            };
            registerExtensionMenus([extension], views.menuRegistry);
            registerExtensionViews([extension], {
                views: views.service,
                commands: views.commands,
                contextKeys: views.contextKeys,
                notify: () => undefined,
                logger: {
                    warn: (line: string) => viewsLog.push(line),
                    error: (line: string) => viewsLog.push(line),
                } as never,
            });
            views.service.attachRegisteredContainers();
            views.showViewlet(CONTAINER);
            const errors: string[] = [];
            const adapter = new ExtensionTreeViewsAdapter({
                views: views.service,
                welcomes: new ExtensionViewWelcomes(views.service, views.contextKeys, views.commands, {
                    open: () => Promise.resolve(false),
                }),
                commands: views.commands,
                menus: views.menuRegistry,
                menuService: views.menuService,
                contextMenu: views.contextMenu,
                contextKeys: views.contextKeys,
                configuration: new InMemoryConfigurationService(new ConfigurationRegistry()),
                workspace: views.workspace,
                colors: { resolve: () => undefined },
                notifyError: (message) => errors.push(message),
                logger: {
                    warn: (line: string) => errors.push(line),
                    error: (line: string) => errors.push(line),
                } as never,
            });
            const harness: IExtensionHarness = await createExtensionTestHarness({
                activateEvents: [],
                treeViewsSink: adapter,
                commandRegistry: views.commands,
                extensions: [registration],
            });
            // The workbench's `setContext`: the view's `when` reads `vscode-maven:activated`.
            new SetContextCommandContribution(harness.commandRegistry, views.contextKeys);
            try {
                writeMavenProject(harness.tmpDir);
                await harness.host.activateByEvent("workspaceContains:**/pom.xml");
                expect(harness.host.hasExtension(MAVEN_ID)).toBe(true);

                const paneView = views.paneView(CONTAINER);
                // The view's `when` reads `vscode-maven:activated`, which activation sets.
                await waitUntil("the MAVEN pane", () => paneTitles(paneView).length === 2, 30_000);
                if (paneView.isCollapsed(VIEW)) paneView.toggleCollapsed(VIEW);
                const app = TestApp.createWithContent(views.root(CONTAINER), new Size(60, 30));
                const frame = (): string => {
                    app.render();
                    return app.backend.screenToString();
                };
                await waitUntil(
                    "both modules in the tree",
                    () => {
                        const text = frame();
                        return text.includes("b a:b") && text.includes("child a:child");
                    },
                    60_000,
                );

                const lines = frame().split("\n");
                const row = lines.findIndex((line) => line.includes("child a:child"));
                for (const action of ["press", "release"] as const) {
                    app.backend.simulateMouse({
                        kind: "mouse",
                        button: "left",
                        x: (lines[row] ?? "").indexOf("child") + 1,
                        y: row + 1,
                        action,
                        shiftKey: false,
                        altKey: false,
                        ctrlKey: false,
                        raw: "",
                    });
                }
                await waitUntil("Lifecycle under the project", () => frame().includes("Lifecycle"), 30_000);
                expect(errors).toEqual([]);
                expect(viewsLog).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
