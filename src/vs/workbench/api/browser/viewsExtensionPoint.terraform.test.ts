import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../../../../TestUtils/marketplaceEnv.ts";
import { fetchStockVsix } from "../../../../TestUtils/stockVsix.ts";
import { TERRAFORM_ID } from "../../../../TestUtils/terraformFixture.ts";
import { installVsix } from "../../../platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import type { IExtensionManifest } from "../../../platform/extensions/common/iExtensionManifest.ts";
import type { PaneHeaderElement } from "../../browser/parts/views/paneHeaderElement.ts";
import { makeViewsHarness, paneTitles, testView } from "../../browser/parts/views/viewsService.testUtils.ts";
import { computeActivationEvents } from "../../services/extensions/common/activationEvents.ts";

import { registerExtensionViews } from "./viewsExtensionPoint.ts";

// Stock hashicorp.terraform declares two activity bar containers ("HashiCorp Terraform", "HCP Terraform")
// and a panel one, each with tree views. The contract itself is gated hermetically in
// viewsExtensionPoint.test.ts; this suite checks the real manifest lands where the user looks.

let extensionsDir: string;
let terraform: IExtension;

describe.skipIf(MARKETPLACE_OFFLINE)("views extension point — stock hashicorp.terraform", () => {
    beforeAll(async () => {
        extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
        const { id, version } = await installVsix((await fetchStockVsix(TERRAFORM_ID)).vsixPath, extensionsDir);
        const dirName = `${id}-${version}`;
        const manifest = JSON.parse(
            fs.readFileSync(path.join(extensionsDir, dirName, "package.json"), "utf8"),
        ) as IExtensionManifest;
        terraform = { id, manifest, location: `UserExtensions/${dirName}/`, isBuiltin: false };
    }, 120_000);

    afterAll(() => {
        fs.rmSync(extensionsDir, { recursive: true, force: true });
    });

    it("its activity bar containers join the switcher, the panel one joins the panel", () => {
        const h = makeViewsHarness();
        h.service.registerContainer({
            id: "explorer",
            title: "EXPLORER",
            location: "sidebar",
            order: 0,
            isDefault: true,
        });
        h.service.registerView(testView("explorer.files", "explorer", 0));
        const log: string[] = [];
        registerExtensionViews([terraform], {
            views: h.service,
            commands: h.commands,
            contextKeys: h.contextKeys,
            notify: () => {},
            logger: { warn: (line: string) => log.push(line), error: (line: string) => log.push(line) } as never,
        });
        h.service.attachRegisteredContainers();

        expect(log).toEqual([]);
        expect(paneTitles(h.paneView("workbench.view.extension.terraform"))).toEqual(["PROVIDERS", "MODULE CALLS"]);
        // The panel container's views are `when`-gated on a plan/apply being viewed: until then it takes no place.
        expect(h.service.getViewContainers().map((c) => c.id)).not.toContain(
            "workbench.view.extension.terraform-cloud-panel",
        );

        const header = h.paneView("explorer").querySelector("#paneHeader-explorer-files") as PaneHeaderElement;
        header.onSwitch?.({ screenX: 0, screenY: 1 });
        const entries = (h.shown.at(-1)?.getEntries?.() ?? []) as MenuItemEntry[];
        expect(entries.map((entry) => entry.label)).toEqual(["Explorer", "HashiCorp Terraform", "HCP Terraform"]);

        entries[1].onSelect?.();
        expect(h.shownViewlets.at(-1)).toEqual({ id: "workbench.view.extension.terraform", reveal: true, focus: true });
    });

    it("opening a view is an activation event of the extension", () => {
        const events = computeActivationEvents(terraform.manifest, terraform.id);
        expect(events).toEqual(
            expect.arrayContaining(["onView:terraform.providers", "onView:terraform.cloud.workspaces"]),
        );
    });
});
