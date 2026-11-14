import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { FileDialogServiceDIToken } from "../../../services/dialogs/browser/fileDialogService.ts";
import type { IOpenDialogOptions } from "../../../services/dialogs/browser/simpleFileDialog.ts";
import {
    NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import type { IExtensionsWorkbenchService, IVsixInstallResult } from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import {
    ExtensionVsixContribution,
    INSTALL_FROM_VSIX_COMMAND_ID,
    installVsixAction,
    vsixPathsOf,
} from "./extensionVsixActions.ts";

describe("vsixPathsOf", () => {
    it("takes a URI, a list of them, their structured clone or JSON, and plain paths", () => {
        const uri = Uri.file("/tmp/a.vsix");

        expect(vsixPathsOf(uri)).toEqual(["/tmp/a.vsix"]);
        expect(vsixPathsOf([structuredClone(uri), JSON.parse(JSON.stringify(Uri.file("/tmp/b.vsix")))])).toEqual([
            "/tmp/a.vsix",
            "/tmp/b.vsix",
        ]);
        // A string is a path as is, not a URI to parse: `#` and `%` stay in the file name.
        expect(vsixPathsOf("/tmp/v 100%#1.vsix")).toEqual(["/tmp/v 100%#1.vsix"]);
    });

    it.each([
        [Uri.parse("https://example.com/a.vsix"), "https://example.com/a.vsix"],
        [undefined, "undefined"],
        [null, "null"],
        [{ path: "/a.vsix" }, '{"path":"/a.vsix"}'],
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

    const running: IVsixInstallResult = { needsReload: false };
    const fresh: IVsixInstallResult = { needsReload: true };

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

describe("Extensions: Install from VSIX... (palette)", () => {
    function setup(picked: Uri[] | undefined, installVsix: (vsixPath: string) => Promise<IVsixInstallResult>) {
        const container = new Container();
        const notifications = new NotificationService();
        const dialogs: IOpenDialogOptions[] = [];
        const installed: string[] = [];
        container.bind(NotificationServiceDIToken, () => notifications);
        container.bind(FileDialogServiceDIToken, () => ({
            showOpenDialog: (options?: IOpenDialogOptions) => {
                dialogs.push(options ?? {});
                return Promise.resolve(picked);
            },
            showSaveDialog: () => Promise.resolve(undefined),
        }));
        container.bind(
            ExtensionsWorkbenchServiceDIToken,
            () =>
                ({
                    installVsix: (vsixPath: string) => {
                        installed.push(vsixPath);
                        return installVsix(vsixPath);
                    },
                }) as unknown as IExtensionsWorkbenchService,
        );
        return {
            run: () => installVsixAction.run(container) as Promise<void>,
            dialogs,
            installed,
            shown: () => notifications.current() ?? notifications.passive()[0],
        };
    }

    it("opens upstream's dialog: several .vsix files, the Install button; installs what was picked", async () => {
        const h = setup([Uri.file("/a.vsix"), Uri.file("/b.vsix")], () => Promise.resolve({ needsReload: true }));

        await h.run();

        expect(h.dialogs).toEqual([
            {
                title: "Install from VSIX",
                filters: [{ name: "VSIX Extensions", extensions: ["vsix"] }],
                canSelectFiles: true,
                canSelectMany: true,
                openLabel: "Install",
            },
        ]);
        expect(h.installed).toEqual(["/a.vsix", "/b.vsix"]);
    });

    it("a cancelled dialog installs nothing and shows nothing", async () => {
        const h = setup(undefined, () => Promise.resolve({ needsReload: true }));

        await h.run();

        expect(h.installed).toEqual([]);
        expect(h.shown()).toBeUndefined();
    });

    it("a failure is an error notification, whatever the rejection carries", async () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point: a layer that rejects with a non-Error
        const h = setup([Uri.file("/a.vsix")], () => Promise.reject("disk is full"));

        await h.run();

        expect(h.shown()).toMatchObject({ severity: "error", message: "disk is full" });
    });
});
