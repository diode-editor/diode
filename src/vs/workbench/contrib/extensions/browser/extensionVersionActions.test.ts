import { describe, expect, it } from "vitest";

import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { QuickPickOptions, QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type {
    INotificationMessage,
    NotificationService,
} from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type {
    IExtensionInstallOptions,
    IExtensionInstallResult,
    IExtensionListEntry,
    IExtensionsWorkbenchService,
} from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import type { IExtensionPageActions } from "./extensionPageActions.ts";
import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import type { ExtensionsComponent } from "./extensionsComponent.ts";
import { ExtensionsComponentDIToken } from "./extensionsComponent.ts";
import {
    canInstallSpecificVersion,
    ExtensionVersionContribution,
    INSTALL_ANOTHER_VERSION_COMMAND_ID,
    installSpecificVersionOfExtensionAction,
} from "./extensionVersionActions.ts";

function entry(id: string, overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    const [publisher, name] = id.split(".");
    return {
        id,
        publisher,
        name,
        displayName: name,
        description: "",
        kind: "native",
        support: undefined,
        latestVersion: "1.1.0",
        installedVersion: "1.1.0",
        availability: "installed",
        pinned: false,
        needsReload: false,
        ...overrides,
    };
}

interface IHarness {
    readonly container: Container;
    readonly commands: CommandRegistry;
    readonly contextKeys: ContextKeyService;
    readonly calls: string[];
    readonly picks: QuickPickOptions[];
    readonly messages: INotificationMessage[];
    setEntries(entries: IExtensionListEntry[]): void;
}

/** `pickAnswers` answer the quick picks in order, by label; `version` is what the version picker returns. */
function harness(
    initial: IExtensionListEntry[],
    options: {
        pickAnswers?: (string | undefined)[];
        version?: string | undefined | Error;
        install?: IExtensionInstallResult;
    } = {},
): IHarness {
    let entries = initial;
    const listeners = new Set<() => void>();
    const calls: string[] = [];
    const picks: QuickPickOptions[] = [];
    const messages: INotificationMessage[] = [];
    const answers = [...(options.pickAnswers ?? [])];
    const service: IExtensionsWorkbenchService = {
        ensureLoaded: () => {
            calls.push("ensureLoaded");
            return Promise.resolve();
        },
        refresh: () => Promise.resolve(),
        getEntries: () => entries,
        getCatalogError: () => null,
        getMeta: () => Promise.resolve(undefined),
        getCompatibleVersions: () => Promise.resolve([]),
        install: () => Promise.resolve({ ok: true, version: "1.0.0" }),
        uninstall: () => Promise.resolve({ ok: true }),
        onDidChange: (listener) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
    };
    const actions: IExtensionPageActions = {
        install: (id: string, installOptions?: IExtensionInstallOptions) => {
            calls.push(`install:${id}@${String(installOptions?.version)}`);
            return Promise.resolve(options.install ?? { ok: true, version: installOptions?.version ?? "1.1.0" });
        },
        uninstall: () => Promise.resolve({ ok: true }),
        pickVersion: (id) => {
            calls.push(`pickVersion:${id}`);
            const version = options.version;
            return version instanceof Error ? Promise.reject(version) : Promise.resolve(version);
        },
        reloadWindow: () => undefined,
    };
    const container = new Container();
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    container.bind(ExtensionsWorkbenchServiceDIToken, () => service);
    container.bind(ExtensionPageActionsDIToken, () => actions);
    container.bind(ContextKeyServiceDIToken, () => contextKeys);
    container.bind(
        QuickInputServiceDIToken,
        () =>
            ({
                quickPick: (pickOptions: QuickPickOptions) => {
                    picks.push(pickOptions);
                    const answer = answers.shift();
                    return Promise.resolve(pickOptions.items.find((item) => item.label === answer));
                },
            }) as unknown as QuickInputService,
    );
    container.bind(
        NotificationServiceDIToken,
        () =>
            ({
                show: (message: INotificationMessage) => {
                    messages.push(message);
                    return { id: messages.length, answered: Promise.resolve(undefined) };
                },
            }) as unknown as NotificationService,
    );
    container.bind(
        ExtensionsComponentDIToken,
        () =>
            ({
                openExtensionPage: (id: string) => {
                    calls.push(`open:${id}`);
                    return Promise.resolve();
                },
            }) as unknown as ExtensionsComponent,
    );
    return {
        container,
        commands,
        contextKeys,
        calls,
        picks,
        messages,
        setEntries: (next) => {
            entries = next;
            for (const listener of [...listeners]) listener();
        },
    };
}

describe("canInstallSpecificVersion", () => {
    it("before the catalog is read any installed extension may be from the registry (no network at startup)", () => {
        expect(canInstallSpecificVersion([entry("acme.solo", { latestVersion: null })])).toBe(true);
        expect(canInstallSpecificVersion([])).toBe(false);
    });

    it("with the catalog read, only an installed extension the registry knows counts (US-1.14)", () => {
        const catalogOnly = entry("acme.catalog", { installedVersion: null, availability: "available" });
        const sideloaded = entry("acme.solo", { latestVersion: null });

        expect(canInstallSpecificVersion([catalogOnly, sideloaded])).toBe(false);
        expect(canInstallSpecificVersion([catalogOnly, sideloaded, entry("acme.demo")])).toBe(true);
    });
});

describe("Install Specific Version of Extension... (US-1.6)", () => {
    it("has the upstream id and title, and is enabled by the context key", () => {
        expect(installSpecificVersionOfExtensionAction.id).toBe("workbench.extensions.action.install.specificVersion");
        expect(installSpecificVersionOfExtensionAction.title).toBe(
            "Extensions: Install Specific Version of Extension...",
        );
        expect(installSpecificVersionOfExtensionAction.enablement).toBe("extensionsCanInstallSpecificVersion");
    });

    it("lists installed registry extensions by displayName, then installs the picked version and opens its page", async () => {
        const h = harness(
            [
                entry("acme.zeta", { displayName: "Zeta" }),
                entry("acme.solo", { displayName: "Alone", latestVersion: null }),
                entry("acme.catalog", { displayName: "Catalog", installedVersion: null }),
                entry("acme.alpha", { displayName: "Alpha" }),
            ],
            { pickAnswers: ["Zeta"], version: "1.0.0" },
        );

        await installSpecificVersionOfExtensionAction.run(h.container);

        expect(h.picks[0]?.placeholder).toBe("Select Extension");
        expect(h.picks[0]?.items.map((i) => [i.label, i.description])).toEqual([
            ["Alpha", "acme.alpha"],
            ["Zeta", "acme.zeta"],
        ]);
        // The catalog is read first: without it nothing is known to the registry.
        expect(h.calls).toEqual(["ensureLoaded", "pickVersion:acme.zeta", "install:acme.zeta@1.0.0", "open:acme.zeta"]);
    });

    it("Escape in the extension list does nothing", async () => {
        const h = harness([entry("acme.demo")], { pickAnswers: [undefined], version: "1.0.0" });

        await installSpecificVersionOfExtensionAction.run(h.container);

        expect(h.calls).toEqual(["ensureLoaded"]);
    });

    it("no installed registry extension after reading the catalog — an info message instead of an empty list", async () => {
        const h = harness([entry("acme.solo", { latestVersion: null })]);

        await installSpecificVersionOfExtensionAction.run(h.container);

        expect(h.picks).toEqual([]);
        expect(h.messages).toEqual([
            {
                severity: "info",
                message: "There are no installed extensions from the marketplace.",
                modal: false,
                items: [],
            },
        ]);
    });
});

describe("ExtensionVersionContribution", () => {
    function contribution(h: IHarness): ExtensionVersionContribution {
        return new ExtensionVersionContribution(
            h.container.get(ExtensionsWorkbenchServiceDIToken),
            h.contextKeys,
            h.commands,
            h.container,
        );
    }

    it("keeps the palette context key in step with the entries", () => {
        const h = harness([]);
        const subject = contribution(h);
        expect(h.contextKeys.get("extensionsCanInstallSpecificVersion")).toBe(false);

        h.setEntries([entry("acme.demo")]);
        expect(h.contextKeys.get("extensionsCanInstallSpecificVersion")).toBe(true);

        subject.dispose();
        h.setEntries([]);
        expect(h.contextKeys.get("extensionsCanInstallSpecificVersion")).toBe(true);
    });

    it("the palette command is available only with the key set", () => {
        const h = harness([]);
        contribution(h);
        registerAction(h.commands, new KeybindingRegistry(), h.container, installSpecificVersionOfExtensionAction);

        expect(h.commands.listCommands().map((c) => c.id)).toContain(installSpecificVersionOfExtensionAction.id);
        expect(h.contextKeys.evaluate(installSpecificVersionOfExtensionAction.enablement!)).toBe(false);
        h.setEntries([entry("acme.demo")]);
        expect(h.contextKeys.evaluate(installSpecificVersionOfExtensionAction.enablement!)).toBe(true);
    });

    it("registers the page command without a title — it is not in the palette (upstream: not in f1)", async () => {
        const h = harness([entry("acme.demo")], { version: "1.0.0" });
        const subject = contribution(h);

        expect(INSTALL_ANOTHER_VERSION_COMMAND_ID).toBe("workbench.extensions.action.install.anotherVersion");
        expect(h.commands.has(INSTALL_ANOTHER_VERSION_COMMAND_ID)).toBe(true);
        expect(h.commands.listCommands().map((c) => c.id)).not.toContain(INSTALL_ANOTHER_VERSION_COMMAND_ID);

        await h.commands.execute(INSTALL_ANOTHER_VERSION_COMMAND_ID, "acme.demo");
        expect(h.calls).toEqual(["pickVersion:acme.demo", "install:acme.demo@1.0.0"]);

        subject.dispose();
        expect(h.commands.has(INSTALL_ANOTHER_VERSION_COMMAND_ID)).toBe(false);
    });

    it("the page command without an id or with nothing picked does nothing", async () => {
        const h = harness([entry("acme.demo")], { version: undefined });
        contribution(h);

        await h.commands.execute(INSTALL_ANOTHER_VERSION_COMMAND_ID);
        await h.commands.execute(INSTALL_ANOTHER_VERSION_COMMAND_ID, "acme.demo");

        expect(h.calls).toEqual(["pickVersion:acme.demo"]);
        expect(h.messages).toEqual([]);
    });

    it("US-1.13: a registry or install failure off the page is an error notification", async () => {
        const offline = harness([entry("acme.demo")], { version: new Error("registry offline") });
        contribution(offline);
        await offline.commands.execute(INSTALL_ANOTHER_VERSION_COMMAND_ID, "acme.demo");

        const broken = harness([entry("acme.demo")], {
            version: "1.0.0",
            install: { ok: false, error: "sha256 mismatch" },
        });
        contribution(broken);
        await broken.commands.execute(INSTALL_ANOTHER_VERSION_COMMAND_ID, "acme.demo");

        expect([...offline.messages, ...broken.messages]).toEqual([
            { severity: "error", message: "registry offline", modal: false, items: [] },
            { severity: "error", message: "sha256 mismatch", modal: false, items: [] },
        ]);
    });
});
