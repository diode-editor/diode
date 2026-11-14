import * as fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../TestUtils/domQueries.ts";
import { buildVsix } from "../../../TestUtils/extensionUpdatesFixture.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../base/common/uri.ts";
import { INSTALL_FROM_VSIX_COMMAND_ID } from "../contrib/extensions/browser/extensionVsixActions.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

/**
 * `installFromVSIX` (#1134) over the real marketplace service and a real extensions directory: what CodeLLDB
 * calls for its platform package, and the palette's "Extensions: Install from VSIX...".
 */
describe("Workbench — install from VSIX", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
        h = undefined;
        ws = undefined;
    });

    async function setup(): Promise<{ h: IAppHarness; ws: ITempWorkspace; vsix: string }> {
        ws = createTempWorkspace({ prefix: "diode-install-vsix-" });
        const vsix = ws.path("acme.tools-1.0.0.vsix");
        await buildVsix(vsix, { publisher: "acme", name: "tools", version: "1.0.0" }, { "extension/main.js": "" });
        h = createAppTestHarness({ workspaceFolder: ws.dir, environment: { extensionsDir: ws.path("extensions") } });
        return { h, ws, vsix };
    }

    function screen(harness: IAppHarness): string {
        harness.testApp.render();
        return harness.testApp.backend.screenToString();
    }

    it("an extension's `[Uri]` installs the vsix and offers a reload", async () => {
        const { h, ws, vsix } = await setup();
        // What arrives from the extension host: the structured clone of a `vscode.Uri`.
        const fromExtension = [structuredClone(Uri.file(vsix))];

        await h.commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, fromExtension);

        expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0/main.js"))).toBe(true);
        const shown = screen(h);
        // The toast wraps the message.
        expect(shown).toContain("Completed installing extension. Please reload");
        expect(shown).toContain("Diode to enable it.");
        expect(shown).toContain("[ Reload Now ]");
    });

    it("Reload Now reloads the window", async () => {
        const { h, vsix } = await setup();
        await h.commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, vsix);
        const execute = vi.spyOn(h.commands, "execute");

        const notifications = h.container.get(NotificationServiceDIToken);
        const shown = notifications.current();
        expect(shown?.items).toEqual(["Reload Now"]);
        notifications.answer(shown!.id, 0);
        await vi.waitFor(() => {
            expect(execute).toHaveBeenCalledWith("workbench.action.reloadWindow");
        });
    });

    it("a broken vsix rejects the command with the reason and installs nothing", async () => {
        const { h, ws } = await setup();
        fs.writeFileSync(ws.path("broken.vsix"), "not a zip");

        await expect(h.commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, [ws.path("broken.vsix")])).rejects.toThrow(
            "Not a valid .vsix (zip) archive",
        );
        expect(fs.readdirSync(ws.path("extensions"))).toEqual([]);
    });

    it("the palette asks for the path in a quick input and installs the typed file", async () => {
        const { h, ws, vsix } = await setup();

        h.commands.execute("workbench.extensions.action.installVSIX");
        expect(screen(h)).toContain("Path to a .vsix file");
        typeText(h.testApp, vsix);
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(screen(h)).toContain("Completed installing extension. Please reload");
        });
        expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0/package.json"))).toBe(true);
    });

    it("the palette shows a failed install as an error notification", async () => {
        const { h, ws } = await setup();

        h.commands.execute("workbench.extensions.action.installVSIX");
        typeText(h.testApp, ws.path("missing.vsix"));
        h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(screen(h)).toContain("Not a valid .vsix (zip) archive");
        });
    });

    it("an empty path is a cancel: nothing is installed, nothing is shown", async () => {
        const { h, ws } = await setup();

        h.commands.execute("workbench.extensions.action.installVSIX");
        typeText(h.testApp, "  ");
        h.testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(screen(h)).not.toContain("Path to a .vsix file");
        });

        const notifications = h.container.get(NotificationServiceDIToken);
        expect(notifications.current()).toBeNull();
        expect(notifications.passive()).toEqual([]);
        expect(fs.existsSync(ws.path("extensions"))).toBe(false);
    });
});
