import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import type { IExtensionsWorkbenchService, IVsixInstallResult } from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import { ExtensionVsixContribution, INSTALL_FROM_VSIX_COMMAND_ID, vsixPathsOf } from "./extensionVsixActions.ts";

describe("vsixPathsOf", () => {
    it("takes a URI, a list of them, their structured clone or JSON, and plain paths", () => {
        const uri = Uri.file("/tmp/a.vsix");

        expect(vsixPathsOf(uri)).toEqual(["/tmp/a.vsix"]);
        expect(vsixPathsOf([structuredClone(uri), JSON.parse(JSON.stringify(Uri.file("/tmp/b.vsix")))])).toEqual([
            "/tmp/a.vsix",
            "/tmp/b.vsix",
        ]);
        expect(vsixPathsOf("/tmp/c.vsix")).toEqual(["/tmp/c.vsix"]);
    });

    it.each([
        [Uri.parse("https://example.com/a.vsix"), "https://example.com/a.vsix"],
        [undefined, "undefined"],
        [null, "null"],
        [{ scheme: "file" }, '{"scheme":"file"}'],
    ])("refuses %s: only a file can be installed", (resource, shown) => {
        expect(() => vsixPathsOf(resource)).toThrow(
            `Cannot install a VSIX from ${shown}: expected a file URI or a path`,
        );
    });
});

describe("workbench.extensions.command.installFromVSIX — the announcement", () => {
    function setup(results: Record<string, IVsixInstallResult>): {
        run: (resources: unknown) => Promise<unknown>;
        shown: () => unknown;
    } {
        const container = new Container();
        const commands = new CommandRegistry();
        const notifications = new NotificationService();
        container.bind(NotificationServiceDIToken, () => notifications);
        container.bind(
            ExtensionsWorkbenchServiceDIToken,
            () =>
                ({
                    installVsix: (vsixPath: string) => Promise.resolve(results[vsixPath]),
                }) as unknown as IExtensionsWorkbenchService,
        );
        new ExtensionVsixContribution(commands, container);
        return {
            run: (resources) => commands.execute(INSTALL_FROM_VSIX_COMMAND_ID, resources) as Promise<unknown>,
            // A toast without buttons is passive; one with buttons waits for an answer.
            shown: () => notifications.current() ?? notifications.passive()[0],
        };
    }

    const running: IVsixInstallResult = { id: "vadimcn.vscode-lldb", version: "1.12.3", needsReload: false };
    const fresh: IVsixInstallResult = { id: "acme.tools", version: "1.0.0", needsReload: true };

    it("a platform package of the running extension needs no reload: a plain info", async () => {
        const { run, shown } = setup({ "/a.vsix": running });

        await run([Uri.file("/a.vsix")]);

        expect(shown()).toMatchObject({
            severity: "info",
            message: "Completed installing extension.",
            items: [],
        });
    });

    it("several files are announced together, with a reload once any of them needs one", async () => {
        const { run, shown } = setup({ "/a.vsix": running, "/b.vsix": fresh });

        await run(["/a.vsix", "/b.vsix"]);

        expect(shown()).toMatchObject({
            message: "Completed installing extensions. Please reload Diode to enable them.",
            items: ["Reload Now"],
        });
    });

    it("several files that need no reload", async () => {
        const { run, shown } = setup({ "/a.vsix": running, "/b.vsix": running });

        await run(["/a.vsix", "/b.vsix"]);

        expect(shown()).toMatchObject({ message: "Completed installing extensions." });
    });
});
