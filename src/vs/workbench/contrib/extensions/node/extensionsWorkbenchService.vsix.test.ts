import * as fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { buildVsix, createUpdatesFixture } from "../../../../../TestUtils/extensionUpdatesFixture.ts";

/** `installFromVSIX` (#1134): CodeLLDB installs its platform package over the running universal one. */
describe("ExtensionsWorkbenchService.installVsix", () => {
    const fixture = createUpdatesFixture();
    const { warnings, registry, installed, createService, profileState, workspace } = fixture;

    afterEach(() => {
        fixture.dispose();
    });

    async function vsix(
        name: string,
        manifest: Record<string, unknown>,
        files: Record<string, string> = {},
    ): Promise<string> {
        const file = workspace().path(`downloads/${name}.vsix`);
        fs.mkdirSync(workspace().path("downloads"), { recursive: true });
        await buildVsix(file, { publisher: "vadimcn", name: "vscode-lldb", version: "1.12.3", ...manifest }, files);
        return file;
    }

    it("a platform package of the running version replaces its files in place: no reload", async () => {
        installed("vadimcn.vscode-lldb", "1.12.3");
        const service = createService(await registry({}));
        const platformPackage = await vsix("codelldb-linux-x64", {}, { "extension/adapter/codelldb": "binary" });

        const result = await service.installVsix(platformPackage);

        expect(result).toEqual({ id: "vadimcn.vscode-lldb", version: "1.12.3", needsReload: false });
        // The running extension's `extensionPath` now has the adapter.
        const dir = workspace().path("extensions/vadimcn.vscode-lldb-1.12.3");
        expect(fs.readFileSync(`${dir}/adapter/codelldb`, "utf8")).toBe("binary");
        // Upstream `installGivenVersion`: the vsix pins the version.
        expect(profileState()).toEqual([["vadimcn.vscode-lldb", "1.12.3", true]]);
        expect(service.getEntries().find((e) => e.id === "vadimcn.vscode-lldb")?.needsReload).toBe(false);
    });

    it("a new extension or another version waits for a window reload, and its entry says so", async () => {
        installed("vadimcn.vscode-lldb", "1.12.2");
        const service = createService(await registry({}));
        let changes = 0;
        service.onDidChange(() => changes++);

        const result = await service.installVsix(await vsix("newer", {}));

        expect(result.needsReload).toBe(true);
        expect(changes).toBe(1);
        expect(profileState()).toEqual([["vadimcn.vscode-lldb", "1.12.3", true]]);
        expect(service.getEntries().find((e) => e.id === "vadimcn.vscode-lldb")).toMatchObject({
            installedVersion: "1.12.3",
            needsReload: true,
        });
    });

    it("an extension reinstalled earlier in the session is not the running one: a second install still waits", async () => {
        const service = createService(await registry({}));
        await service.installVsix(await vsix("first", {}));

        const again = await service.installVsix(await vsix("second", {}));

        expect(again.needsReload).toBe(true);
    });

    it("installed dependencies wait for a reload even when the extension itself is running", async () => {
        installed("vadimcn.vscode-lldb", "1.12.3");
        const source = await registry({ "acme.base": [{ version: "1.0.0" }] });
        const service = createService(source);

        const result = await service.installVsix(await vsix("with-deps", { extensionDependencies: ["acme.base"] }));

        expect(result.needsReload).toBe(true);
        expect(service.getEntries().find((e) => e.id === "acme.base")?.needsReload).toBe(true);
        expect(service.getEntries().find((e) => e.id === "vadimcn.vscode-lldb")?.needsReload).toBe(false);
    });

    it("a failed dependency install is a warning: the extension is installed", async () => {
        const source = await registry({});
        source.failMeta.add("acme.base");
        const service = createService(source);

        const result = await service.installVsix(await vsix("deps", { extensionDependencies: ["acme.base"] }));

        expect(result.id).toBe("vadimcn.vscode-lldb");
        expect(warnings).toEqual([
            "Could not install the dependencies of vadimcn.vscode-lldb: meta of acme.base is unreachable",
        ]);
        expect(profileState()).toEqual([["vadimcn.vscode-lldb", "1.12.3", true]]);
    });

    it("a broken archive rejects with the reason and leaves the profile as it was", async () => {
        installed("vadimcn.vscode-lldb", "1.12.3");
        const service = createService(await registry({}));
        const broken = workspace().path("broken.vsix");
        fs.writeFileSync(broken, "not a zip");

        await expect(service.installVsix(broken)).rejects.toThrow("Not a valid .vsix (zip) archive");
        expect(profileState()).toEqual([["vadimcn.vscode-lldb", "1.12.3", false]]);
    });
});
