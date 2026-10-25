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
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { ExtensionTreeViewsAdapter } from "../../../api/browser/extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "../../../api/browser/extensionViewWelcomes.ts";
import { registerExtensionViews } from "../../../api/browser/viewsExtensionPoint.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";
import { registerExtensionMenus } from "../../extensions/common/extensionMenuContributor.ts";

// Stock hashicorp.terraform fills its "HashiCorp Terraform" container with trees: Providers (a flat list,
// version as the description, `ThemeIcon("package")`) and Module Calls (a nested tree). The contract is
// gated hermetically on a synthetic extension (extensionHost.treeView.test.ts, extensionTreeView.test.ts);
// this suite checks the real extension lands where the user looks.

const CONTAINER = "workbench.view.extension.terraform";

const MAIN_TF = [
    "terraform {",
    "  required_providers {",
    "    aws = {",
    '      source  = "hashicorp/aws"',
    '      version = "~> 5.0"',
    "    }",
    "  }",
    "}",
    "",
    'module "x" {',
    '  source = "./mod"',
    "}",
    "",
].join("\n");

/**
 * What `terraform init` leaves behind: terraform-ls answers `module.providers`/`module.calls` only for a root
 * module ("record not found" otherwise — the same in VS Code). Installed providers come from the lock file.
 */
const LOCK_HCL = [
    '# This file is maintained automatically by "terraform init".',
    'provider "registry.terraform.io/hashicorp/aws" {',
    '  version     = "5.80.0"',
    '  constraints = "~> 5.0"',
    "}",
    "",
].join("\n");
const MODULES_JSON = JSON.stringify({
    Modules: [
        { Key: "", Source: "", Dir: "." },
        { Key: "x", Source: "./mod", Dir: "mod" },
    ],
});

let installed: IInstalledTerraform;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock hashicorp.terraform tree views", () => {
    beforeAll(async () => {
        installed = await installTerraform();
        expect(installed.registration.id).toBe(TERRAFORM_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "Providers lists aws with its installed version and package icon; Module Calls lists the local module and its menu offers Open Documentation",
        { timeout: 180_000 },
        async () => {
            const views = makeViewsHarness();
            const { registration } = installed;
            const viewsLog: string[] = [];
            const extension = {
                id: registration.id,
                manifest: registration.manifest as IExtensionManifest,
                location: "UserExtensions/terraform/",
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
                languageService: TF_LANGUAGE_SERVICE,
                activateEvents: [],
                treeViewsSink: adapter,
                commandRegistry: views.commands,
                extensions: [registration],
            });
            // The workbench's `setContext`: terraform calls it from `getChildren`.
            new SetContextCommandContribution(harness.commandRegistry, views.contextKeys);
            try {
                fs.mkdirSync(path.join(harness.tmpDir, "mod"));
                fs.mkdirSync(path.join(harness.tmpDir, ".terraform", "modules"), { recursive: true });
                harness.writeFile(path.join("mod", "main.tf"), 'variable "name" {\n  type = string\n}\n');
                harness.writeFile(".terraform.lock.hcl", LOCK_HCL);
                harness.writeFile(path.join(".terraform", "modules", "modules.json"), MODULES_JSON);
                const mainPath = harness.writeFile("main.tf", MAIN_TF);
                harness.group.openFile(mainPath);
                await harness.host.activateByEvent("onLanguage:terraform");
                expect(harness.host.hasExtension(TERRAFORM_ID)).toBe(true);

                // The manifest may start Module Calls collapsed; the user would expand it.
                const paneView = views.paneView(CONTAINER);
                if (paneView.isCollapsed("terraform.modules")) paneView.toggleCollapsed("terraform.modules");
                const app = TestApp.createWithContent(views.root(CONTAINER), new Size(60, 24));
                const frame = (): string => {
                    app.render();
                    return app.backend.screenToString();
                };
                await waitUntil(
                    "aws in Providers and x in Module Calls",
                    () => {
                        const text = frame();
                        // The module row may carry an icon glyph before its label.
                        return text.includes("hashicorp/aws 5.80.0") && /^\s+(?:\S\s)?x\s*$/mu.test(text);
                    },
                    120_000,
                );

                const lines = frame().split("\n");
                const aws = lines.find((line) => line.includes("hashicorp/aws 5.80.0"));
                expect(aws).toContain(`${CODICON_GLYPHS.package} hashicorp/aws`);

                // `view/item/context` `terraform.modules.openDocumentation` (`when: view == terraform.modules`).
                const moduleRow = lines.findIndex((line) => /^\s+(?:\S\s)?x\s*$/u.test(line));
                const column = (lines[moduleRow] ?? "").lastIndexOf("x");
                for (const action of ["press", "release"] as const) {
                    app.backend.simulateMouse({
                        kind: "mouse",
                        button: "right",
                        x: column + 1,
                        y: moduleRow + 1,
                        action,
                        shiftKey: false,
                        altKey: false,
                        ctrlKey: false,
                        raw: "",
                    });
                }
                const menu = views.shown.at(-1)?.getEntries?.() ?? [];
                expect(menu.map((entry) => (entry.type === "separator" ? "─" : entry.label))).toEqual([
                    "Open Documentation",
                ]);
                expect(errors).toEqual([]);
                expect(viewsLog).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
