import * as fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { buildVsix } from "../../../TestUtils/extensionUpdatesFixture.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { INSTALL_FROM_VSIX_COMMAND_ID } from "../contrib/extensions/browser/extensionVsixActions.ts";

/**
 * Edge cases of install from VSIX (#1134) as the user meets them: the reason a missing file is reported with, and a
 * home-relative path typed into the palette's path input.
 */
describe("Workbench — install from VSIX, edge cases", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
        h = undefined;
        ws = undefined;
    });

    function setup(): { h: IAppHarness; ws: ITempWorkspace } {
        ws = createTempWorkspace({ prefix: "diode-install-vsix-edges-" });
        fs.mkdirSync(ws.path("home"));
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            environment: { extensionsDir: ws.path("extensions"), userHome: ws.path("home") },
        });
        return { h, ws };
    }

    function screen(harness: IAppHarness): string {
        harness.testApp.render();
        return harness.testApp.backend.screenToString();
    }

    it("a missing file is rejected as not found, not as a broken archive", async () => {
        const { h, ws } = setup();

        const result = h.commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, [ws.path("missing.vsix")]);

        await expect(result).rejects.toThrow(/not found|does not exist|no such file|ENOENT/i);
        await expect(result).rejects.not.toThrow("Not a valid .vsix (zip) archive");
    });

    it("the palette path input expands `~` to the home folder", async () => {
        const { h, ws } = setup();
        await buildVsix(
            ws.path("home/tools.vsix"),
            { publisher: "acme", name: "tools", version: "1.0.0" },
            {
                "extension/main.js": "",
            },
        );

        h.commands.execute("workbench.extensions.action.installVSIX");
        // The palette opens the open dialog: the typed `~/` path replaces the folder it starts in.
        const dialog = fileDialogDriver(h);
        await vi.waitFor(() => {
            expect(dialog.component.isOpen()).toBe(true);
        });
        dialog.replaceQuery("~/tools.vsix");
        dialog.key("Enter");

        await vi.waitFor(() => {
            expect(screen(h)).toContain("Completed installing extension");
        });
        expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0/main.js"))).toBe(true);
    });
});
