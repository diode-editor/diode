import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import {
    type IInstalledTerraform,
    installTerraform,
    TERRAFORM_ID,
    TF_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/terraformFixture.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { ExtensionTreeViewsAdapter } from "../../../api/browser/extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "../../../api/browser/extensionViewWelcomes.ts";
import { registerExtensionViews } from "../../../api/browser/viewsExtensionPoint.ts";
import { readViewsWelcome } from "../../../api/browser/viewsWelcomeExtensionPoint.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";

// Stock hashicorp.terraform explains its empty Providers view with `contributes.viewsWelcome`, keyed on
// `config.terraform.languageServer.enable` and on keys it sets through `setContext` from `getChildren`.
// The contract is gated hermetically (extensionViewWelcomes.test.ts); this suite checks the real manifest.

const CONTAINER = "workbench.view.extension.terraform";
const CLOUD_CONTAINER = "workbench.view.extension.terraform-cloud";
const ROOT_MODULES_JSON = JSON.stringify({ Modules: [{ Key: "", Source: "", Dir: "." }] });

let installed: IInstalledTerraform;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock hashicorp.terraform viewsWelcome", () => {
    beforeAll(async () => {
        installed = await installTerraform();
        expect(installed.registration.id).toBe(TERRAFORM_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "no open .tf — the Providers text; a .tf without providers — the no-providers text and its link",
        { timeout: 180_000 },
        async () => {
            const views = makeViewsHarness();
            const { registration } = installed;
            const extension: IExtension = {
                id: registration.id,
                manifest: registration.manifest as IExtensionManifest,
                location: "UserExtensions/terraform/",
                isBuiltin: false,
            };
            // The extension's own default (`contributes.configuration`), as the workbench registers it.
            const configuration = new InMemoryConfigurationService(new ConfigurationRegistry(), {
                "terraform.languageServer.enable": true,
            });
            const contextKeys = new ContextKeyService(configuration);
            const log: string[] = [];
            const logger = {
                warn: (line: string) => log.push(line),
                error: (line: string) => log.push(line),
            } as never;
            registerExtensionViews([extension], {
                views: views.service,
                commands: views.commands,
                contextKeys,
                notify: () => undefined,
                logger,
            });
            const welcomes = new ExtensionViewWelcomes(views.service, contextKeys, views.commands, {
                open: () => Promise.resolve(false),
            });
            welcomes.registerContents(readViewsWelcome([extension], logger));
            views.service.attachRegisteredContainers();
            views.showViewlet(CONTAINER);
            const app = TestApp.createWithContent(views.root(CONTAINER), new Size(60, 24));
            const frame = (): string => {
                app.render();
                return app.backend.screenToString().replace(/\s+/g, " ");
            };
            expect(frame()).toContain(
                "There are no open Terraform files. Please open a Terraform configuration file to see installed providers.",
            );

            const adapter = new ExtensionTreeViewsAdapter({
                views: views.service,
                welcomes,
                commands: views.commands,
                menus: views.menuRegistry,
                configuration,
                workspace: views.workspace,
                colors: { resolve: () => undefined },
                notifyError: (message) => log.push(message),
                logger,
            });
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: TF_LANGUAGE_SERVICE,
                activateEvents: [],
                treeViewsSink: adapter,
                extensions: [registration],
            });
            // The workbench's `setContext`: terraform calls it from `getChildren`.
            new SetContextCommandContribution(harness.commandRegistry, contextKeys);
            try {
                // A root module, as `terraform init` leaves it: terraform-ls answers `module.providers` only for
                // one ("record not found" otherwise, the "cannot provide information" text).
                fs.mkdirSync(path.join(harness.tmpDir, ".terraform", "modules"), { recursive: true });
                harness.writeFile(path.join(".terraform", "modules", "modules.json"), ROOT_MODULES_JSON);
                const mainPath = harness.writeFile("main.tf", 'variable "name" {\n  type = string\n}\n');
                harness.group.openFile(mainPath);
                await harness.host.activateByEvent("onLanguage:terraform");
                expect(harness.host.hasExtension(TERRAFORM_ID)).toBe(true);

                await waitUntil(
                    "the no-providers welcome",
                    () => frame().includes("There are no installed providers found for the current open file."),
                    120_000,
                );
                expect(frame()).toContain("[ Learn more about providers ]");
                expect(frame()).not.toContain("no open Terraform files");

                // A view of only viewsWelcome and no provider: HCP Terraform's Runs.
                views.showViewlet(CLOUD_CONTAINER);
                const cloud = TestApp.createWithContent(views.root(CLOUD_CONTAINER), new Size(60, 24));
                cloud.render();
                expect(cloud.backend.screenToString()).toContain("Select a workspace to view a list of runs");
                expect(log).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
