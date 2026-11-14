import * as fs from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { buildVsix } from "../../../TestUtils/extensionUpdatesFixture.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { Uri } from "../../base/common/uri.ts";
import { INSTALL_FROM_VSIX_COMMAND_ID } from "../contrib/extensions/browser/extensionVsixActions.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

/**
 * `installFromVSIX` (#1134) over the real marketplace service and a real extensions directory: what CodeLLDB
 * calls for its platform package, and the palette's "Extensions: Install from VSIX..." over the open dialog.
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

    it("closing the notification does not reload the window", async () => {
        const { h, vsix } = await setup();
        await h.commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, vsix);
        const execute = vi.spyOn(h.commands, "execute");

        const notifications = h.container.get(NotificationServiceDIToken);
        notifications.dismiss(notifications.current()!.id);
        await settle(0);

        expect(execute).not.toHaveBeenCalledWith("workbench.action.reloadWindow");
    });

    it("a broken vsix rejects the command with the reason and installs nothing", async () => {
        const { h, ws } = await setup();
        fs.writeFileSync(ws.path("broken.vsix"), "not a zip");

        await expect(h.commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, [ws.path("broken.vsix")])).rejects.toThrow(
            "Not a valid .vsix (zip) archive",
        );
        expect(fs.readdirSync(ws.path("extensions"))).toEqual([]);
    });

    /** The palette command opens the terminal open dialog; the path is typed like a human would. */
    async function pickInDialog(harness: IAppHarness, target: string): Promise<void> {
        harness.commands.execute("workbench.extensions.action.installVSIX");
        const dialog = fileDialogDriver(harness);
        await vi.waitFor(() => {
            expect(dialog.component.isOpen()).toBe(true);
        });
        expect(screen(harness)).toContain("Install from VSIX");
        dialog.replaceQuery(target);
        await dialog.settle({ query: target });
        dialog.key("Enter");
    }

    it("the palette picks the file in the open dialog and installs it", async () => {
        const { h, ws, vsix } = await setup();

        await pickInDialog(h, vsix);

        await vi.waitFor(() => {
            expect(screen(h)).toContain("Completed installing extension. Please reload");
        });
        expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0/package.json"))).toBe(true);
    });

    it("the palette shows a failed install as an error notification", async () => {
        const { h, ws } = await setup();
        fs.writeFileSync(ws.path("broken.vsix"), "not a zip");

        await pickInDialog(h, ws.path("broken.vsix"));

        await vi.waitFor(() => {
            expect(screen(h)).toContain("Not a valid .vsix (zip) archive");
        });
    });

    it("Escape in the dialog is a cancel: nothing is installed, nothing is shown", async () => {
        const { h, ws } = await setup();
        h.commands.execute("workbench.extensions.action.installVSIX");
        const dialog = fileDialogDriver(h);
        await vi.waitFor(() => {
            expect(dialog.component.isOpen()).toBe(true);
        });

        dialog.key("Escape");
        await vi.waitFor(() => {
            expect(dialog.component.isOpen()).toBe(false);
        });
        await settle(0);

        const notifications = h.container.get(NotificationServiceDIToken);
        expect(notifications.current()).toBeNull();
        expect(notifications.passive()).toEqual([]);
        expect(fs.existsSync(ws.path("extensions"))).toBe(false);
    });
});
