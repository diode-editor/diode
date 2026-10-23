import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import { AdjustableClock } from "../../../../platform/clock/common/clock.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { extensionsConfiguration } from "../../../common/configuration/extensionsConfiguration.ts";
import type { INotificationMessage } from "../../../services/notification/browser/notificationService.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import type { ExtensionUpdateScheduler } from "../common/extensionUpdateScheduler.ts";

import {
    ConfigurationAutoUpdateSettings,
    ExtensionAutoUpdateContribution,
    TOGGLE_AUTO_UPDATE_COMMAND_ID,
    WorkbenchExtensionUpdateScheduler,
} from "./extensionAutoUpdate.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";

function outdated(id: string, extra: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id,
        publisher: "acme",
        name: id,
        displayName: id,
        description: "",
        kind: "native",
        support: undefined,
        latestVersion: "1.1.0",
        installedVersion: "1.0.0",
        availability: "outdated",
        pinned: false,
        needsReload: false,
        ...extra,
    };
}

function configuration(user: Record<string, unknown> = {}): InMemoryConfigurationService {
    return new InMemoryConfigurationService(new ConfigurationRegistry([extensionsConfiguration]), user);
}

describe("ConfigurationAutoUpdateSettings", () => {
    it("reads upstream's defaults", () => {
        const settings = new ConfigurationAutoUpdateSettings(configuration());

        expect([settings.autoCheckUpdates(), settings.autoUpdate(), settings.autoUpdateDelayHours()]).toEqual([
            true,
            "on",
            2,
        ]);
    });

    it("reads the older `false` as off (decision J1)", () => {
        expect(
            new ConfigurationAutoUpdateSettings(configuration({ "extensions.autoUpdate": false })).autoUpdate(),
        ).toBe("off");
    });

    it("tells which of the three keys changed, and nothing for other keys", async () => {
        const config = configuration();
        const keys: string[] = [];
        new ConfigurationAutoUpdateSettings(config).onDidChange((key) => keys.push(key));

        await config.updateValue("extensions.autoUpdate", "off");
        await config.updateValue("extensions.autoUpdateDelay", 0);
        await config.updateValue("extensions.autoCheckUpdates", false);
        await config.updateValue("extensions.confirmedUriHandlerExtensionIds", ["a.b"]);

        expect(keys).toEqual(["extensions.autoUpdate", "extensions.autoUpdateDelay", "extensions.autoCheckUpdates"]);
    });
});

describe("WorkbenchExtensionUpdateScheduler (US-3.4)", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: Date.parse("2026-10-23T12:00:00Z") });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function setup(answer: number | undefined): {
        read: () => void;
        messages: INotificationMessage[];
        commands: string[];
        scheduler: ExtensionUpdateScheduler;
    } {
        const onDidReadCatalog = new Emitter<boolean>();
        let entries = [outdated("acme.a"), outdated("acme.b")];
        const service = {
            onDidReadCatalog: onDidReadCatalog.event,
            getOutdated: () => entries,
            checkForUpdates: () => Promise.resolve(),
            updateExtensions: (ids: readonly string[]) => {
                entries = [];
                return Promise.resolve({ updated: ids.map((id) => ({ id, version: "1.1.0" })), failed: [] });
            },
        } as Partial<IExtensionsWorkbenchService> as IExtensionsWorkbenchService;
        const messages: INotificationMessage[] = [];
        const notifications = {
            show: (message: INotificationMessage) => {
                messages.push(message);
                return { id: 1, answered: Promise.resolve(answer) };
            },
        };
        const commands: string[] = [];
        const registry = new CommandRegistry();
        registry.register("workbench.action.reloadWindow", () => {
            commands.push("reload");
        });
        const scheduler = new WorkbenchExtensionUpdateScheduler(
            service,
            configuration({ "extensions.autoUpdateDelay": 0 }),
            new AdjustableClock(),
            notifications,
            registry,
            NULL_LOG_SERVICE,
        );
        return {
            read: () => {
                onDidReadCatalog.fire(true);
            },
            messages,
            commands,
            scheduler,
        };
    }

    it("one notification per batch, the Update All text, with Reload Window that reloads", async () => {
        const { read, messages, commands, scheduler } = setup(0);

        read();
        await vi.advanceTimersByTimeAsync(1000);

        expect(messages).toEqual([
            {
                severity: "info",
                message: "Updated 2 extensions. Reload the window to apply.",
                modal: false,
                items: ["Reload Window"],
            },
        ]);
        expect(commands).toEqual(["reload"]);
        scheduler.dispose();
    });

    it("a failure goes to the Extensions log channel, not to a notification", async () => {
        const onDidReadCatalog = new Emitter<boolean>();
        const service = {
            onDidReadCatalog: onDidReadCatalog.event,
            getOutdated: () => [outdated("acme.a")],
            checkForUpdates: () => Promise.resolve(),
            updateExtensions: () => Promise.resolve({ updated: [], failed: [{ id: "acme.a", error: "offline" }] }),
        } as Partial<IExtensionsWorkbenchService> as IExtensionsWorkbenchService;
        const logged: unknown[] = [];
        const logService = {
            ...NULL_LOG_SERVICE,
            createLogger: (channel: string, options?: unknown) => ({
                ...NULL_LOG_SERVICE.createLogger(channel),
                warn: (message: string) => logged.push({ channel, options, message }),
            }),
        };
        const messages: unknown[] = [];
        const scheduler = new WorkbenchExtensionUpdateScheduler(
            service,
            configuration({ "extensions.autoUpdateDelay": 0 }),
            new AdjustableClock(),
            { show: (message) => (messages.push(message), { id: 1, answered: Promise.resolve(undefined) }) },
            new CommandRegistry(),
            logService,
        );

        onDidReadCatalog.fire(true);
        await vi.advanceTimersByTimeAsync(1000);

        expect(logged).toEqual([
            {
                channel: "extensions",
                options: { label: "Extensions" },
                message: "Could not auto-update acme.a: offline",
            },
        ]);
        expect(messages).toEqual([]);
        scheduler.dispose();
    });

    it("closing the notification does not reload", async () => {
        const { read, commands, scheduler } = setup(undefined);

        read();
        await vi.advanceTimersByTimeAsync(1000);

        expect(commands).toEqual([]);
        scheduler.dispose();
    });
});

describe("ExtensionAutoUpdateContribution", () => {
    function setup(entries: IExtensionListEntry[]): {
        contribution: ExtensionAutoUpdateContribution;
        commands: CommandRegistry;
        started: string[];
        toggles: string[];
    } {
        const started: string[] = [];
        const scheduler = {
            start: () => started.push("start"),
            dispose: () => started.push("dispose"),
        } as Partial<ExtensionUpdateScheduler> as ExtensionUpdateScheduler;
        const service = {
            getEntries: () => entries,
        } as Partial<IExtensionsWorkbenchService> as IExtensionsWorkbenchService;
        const toggles: string[] = [];
        const actions = {
            setAutoUpdate: (id: string, enabled: boolean) => {
                toggles.push(`${id}:${String(enabled)}`);
                return Promise.resolve({ ok: true as const });
            },
        } as Partial<IExtensionPageActions> as IExtensionPageActions;
        const commands = new CommandRegistry();
        const contribution = new ExtensionAutoUpdateContribution(scheduler, service, commands, {
            get: () => actions,
        } as never);
        return { contribution, commands, started, toggles };
    }

    it("starts the schedule (the `eventually` phase) and does not own the scheduler", () => {
        const { contribution, started } = setup([]);

        contribution.dispose();

        expect(started).toEqual(["start"]);
    });

    it("upstream's toggleAutoUpdateForExtension flips the entry: a pinned one gets auto-update back", async () => {
        const { commands, toggles } = setup([
            outdated("acme.pinned", { pinned: true }),
            outdated("acme.free"),
            outdated("acme.notInstalled", { installedVersion: null, availability: "available" }),
        ]);

        await commands.execute(TOGGLE_AUTO_UPDATE_COMMAND_ID, "acme.pinned");
        await commands.execute(TOGGLE_AUTO_UPDATE_COMMAND_ID, "acme.free");
        await commands.execute(TOGGLE_AUTO_UPDATE_COMMAND_ID, "acme.notInstalled");
        await commands.execute(TOGGLE_AUTO_UPDATE_COMMAND_ID, "acme.unknown");
        await commands.execute(TOGGLE_AUTO_UPDATE_COMMAND_ID);

        expect(toggles).toEqual(["acme.pinned:true", "acme.free:false"]);
    });

    it("the command has no title: it is not in the palette (upstream: not in f1)", () => {
        const { commands } = setup([]);

        expect(commands.listCommands().find((c) => c.id === TOGGLE_AUTO_UPDATE_COMMAND_ID)).toBeUndefined();
    });
});
