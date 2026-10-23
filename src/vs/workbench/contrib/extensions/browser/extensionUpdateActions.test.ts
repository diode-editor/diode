import { describe, expect, it, vi } from "vitest";

import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProgressService, ProgressServiceDIToken } from "../../../../platform/progress/common/progressService.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type {
    INotificationMessage,
    NotificationService,
} from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type {
    IExtensionListEntry,
    IExtensionsWorkbenchService,
    IExtensionUpdateAllResult,
} from "../common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../common/extensionsWorkbench.ts";

import type { IExtensionPageActions } from "./extensionPageActions.ts";
import { ExtensionPageActionsDIToken } from "./extensionPageActions.ts";
import type { ExtensionsComponent } from "./extensionsComponent.ts";
import { EXTENSIONS_VIEW_ID, EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";
import {
    checkForUpdatesAction,
    describeUpdateAllResult,
    ExtensionUpdateContribution,
    updateAllExtensionsAction,
} from "./extensionUpdateActions.ts";

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
        installedVersion: "1.0.0",
        availability: "outdated",
        pinned: false,
        needsReload: false,
        ...overrides,
    };
}

interface IHarness {
    readonly container: Container;
    readonly calls: string[];
    readonly messages: INotificationMessage[];
    readonly progress: ProgressService;
    readonly service: IExtensionsWorkbenchService;
    setOutdated(outdated: IExtensionListEntry[]): void;
}

/** `afterCheck`: the outdated entries and the catalog error the check leaves behind. */
function harness(
    options: {
        afterCheck?: { outdated: IExtensionListEntry[]; catalogError?: string };
        updateAll?: IExtensionUpdateAllResult;
        answer?: number;
    } = {},
): IHarness {
    const calls: string[] = [];
    const messages: INotificationMessage[] = [];
    const listeners = new Set<() => void>();
    let outdated: IExtensionListEntry[] = [];
    let catalogError: string | null = null;
    const notify = (): void => {
        for (const listener of [...listeners]) listener();
    };
    const service = {
        getEntries: () => outdated,
        getOutdated: () => outdated,
        getCatalogError: () => catalogError,
        checkForUpdates: () => {
            calls.push("service.checkForUpdates");
            return Promise.resolve();
        },
        updateAll: () => {
            calls.push("updateAll");
            return Promise.resolve(options.updateAll ?? { updated: [], failed: [] });
        },
        onDidChange: (listener: () => void) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
    } as Partial<IExtensionsWorkbenchService> as IExtensionsWorkbenchService;
    const container = new Container();
    const progress = new ProgressService();
    container.bind(ExtensionsWorkbenchServiceDIToken, () => service);
    container.bind(ProgressServiceDIToken, () => progress);
    container.bind(
        SidebarServiceDIToken,
        () => ({ showViewlet: (id: string) => calls.push(`show:${id}`) }) as unknown as SidebarService,
    );
    container.bind(
        ExtensionsComponentDIToken,
        () =>
            ({
                checkForUpdates: async () => {
                    calls.push("component.checkForUpdates");
                    await service.checkForUpdates();
                    outdated = options.afterCheck?.outdated ?? [];
                    catalogError = options.afterCheck?.catalogError ?? null;
                },
                setQuery: (query: string) => calls.push(`query:${query}`),
            }) as unknown as ExtensionsComponent,
    );
    container.bind(
        ExtensionPageActionsDIToken,
        () => ({ reloadWindow: () => calls.push("reload") }) as Partial<IExtensionPageActions> as IExtensionPageActions,
    );
    container.bind(
        NotificationServiceDIToken,
        () =>
            ({
                show: (message: INotificationMessage) => {
                    messages.push(message);
                    return { id: messages.length, answered: Promise.resolve(options.answer) };
                },
            }) as unknown as NotificationService,
    );
    return {
        container,
        calls,
        messages,
        progress,
        service,
        setOutdated: (next) => {
            outdated = next;
            notify();
        },
    };
}

describe("Check for Extension Updates (US-2.4)", () => {
    it("has the upstream id and title, and sits first in the section's ... menu", () => {
        expect(checkForUpdatesAction.id).toBe("workbench.extensions.action.checkForUpdates");
        expect(checkForUpdatesAction.title).toBe("Extensions: Check for Extension Updates");
        const placement = checkForUpdatesAction.menus?.[0];
        expect(placement).toMatchObject({ menuId: MenuId.ViewTitle, group: "1_updates", order: 1 });
        expect(placement?.visible?.({ view: EXTENSIONS_VIEW_ID })).toBe(true);
        expect(placement?.visible?.({ view: "workbench.search.results" })).toBe(false);
        // US-2.9: available without the catalog, it loads the catalog itself.
        expect(checkForUpdatesAction.enablement).toBeUndefined();
        expect(checkForUpdatesAction.when).toBeUndefined();
    });

    it("updates found — the viewlet search becomes @outdated", async () => {
        const h = harness({ afterCheck: { outdated: [entry("acme.tools")] } });
        const start = vi.spyOn(h.progress, "withProgress");

        await checkForUpdatesAction.run(h.container);

        expect(h.calls).toEqual([
            "component.checkForUpdates",
            "service.checkForUpdates",
            `show:${EXTENSIONS_VIEWLET_ID}`,
            "query:@outdated ",
        ]);
        expect(start).toHaveBeenCalledWith(
            { location: "view", viewId: EXTENSIONS_VIEW_ID, title: "Checking for extension updates" },
            expect.any(Function),
        );
        expect(h.messages).toEqual([]);
    });

    it("no updates — a modal says everything is up to date, and the search is left alone", async () => {
        const h = harness();

        await checkForUpdatesAction.run(h.container);

        expect(h.messages).toEqual([
            { severity: "info", message: "All extensions are up to date.", modal: true, items: [] },
        ]);
        expect(h.calls).toEqual(["component.checkForUpdates", "service.checkForUpdates"]);
    });

    it("registry unreachable — its error, not 'up to date', even with a stale outdated list", async () => {
        const h = harness({ afterCheck: { outdated: [entry("acme.tools")], catalogError: "offline" } });

        await checkForUpdatesAction.run(h.container);

        expect(h.messages).toEqual([
            {
                severity: "error",
                message: "Could not check for extension updates: offline",
                modal: false,
                items: [],
            },
        ]);
        // The viewlet shows the `Retry —` row; the search is left alone.
        expect(h.calls).toEqual([
            "component.checkForUpdates",
            "service.checkForUpdates",
            `show:${EXTENSIONS_VIEWLET_ID}`,
        ]);
    });
});

describe("Update All Extensions (US-2.6, US-2.7)", () => {
    it("has the upstream id and title, second in the menu, enabled by hasOutdatedExtensions", () => {
        expect(updateAllExtensionsAction.id).toBe("workbench.extensions.action.updateAllExtensions");
        expect(updateAllExtensionsAction.title).toBe("Extensions: Update All Extensions");
        expect(updateAllExtensionsAction.enablement).toBe("hasOutdatedExtensions");
        const placement = updateAllExtensionsAction.menus?.[0];
        expect(placement).toMatchObject({ menuId: MenuId.ViewTitle, group: "1_updates", order: 2 });
        expect(placement?.visible?.({ view: EXTENSIONS_VIEW_ID })).toBe(true);
        expect(placement?.visible?.({ view: "workbench.search.results" })).toBe(false);
    });

    it("updates with window progress and one summary; Reload Window runs the reload command", async () => {
        const h = harness({
            updateAll: {
                updated: [
                    { id: "acme.a", version: "1.1.0" },
                    { id: "acme.b", version: "2.0.0" },
                ],
                failed: [],
            },
            answer: 0,
        });
        const start = vi.spyOn(h.progress, "withProgress");

        await updateAllExtensionsAction.run(h.container);

        expect(start).toHaveBeenCalledWith({ location: "window", title: "Updating extensions" }, expect.any(Function));
        expect(h.messages).toEqual([
            {
                severity: "info",
                message: "Updated 2 extensions. Reload the window to apply.",
                modal: false,
                items: ["Reload Window"],
            },
        ]);
        await vi.waitFor(() => {
            expect(h.calls).toEqual(["updateAll", "reload"]);
        });
    });

    it("closing the summary without a choice does not reload", async () => {
        const h = harness({ updateAll: { updated: [{ id: "acme.a", version: "1.1.0" }], failed: [] } });

        await updateAllExtensionsAction.run(h.container);
        await Promise.resolve();

        expect(h.calls).toEqual(["updateAll"]);
    });
});

describe("describeUpdateAllResult", () => {
    it("all updated — the count, one or many", () => {
        expect(describeUpdateAllResult({ updated: [{ id: "acme.a", version: "1.1.0" }], failed: [] })).toEqual({
            severity: "info",
            message: "Updated 1 extension. Reload the window to apply.",
            modal: false,
            items: ["Reload Window"],
        });
    });

    it("some failed — N of M with the reasons, and still the reload", () => {
        expect(
            describeUpdateAllResult({
                updated: [{ id: "acme.a", version: "1.1.0" }],
                failed: [
                    { id: "acme.b", error: "sha256 mismatch" },
                    { id: "acme.c", error: "offline" },
                ],
            }),
        ).toEqual({
            severity: "warn",
            message: "Updated 1 of 3 extensions. Failed: acme.b — sha256 mismatch; acme.c — offline",
            modal: false,
            items: ["Reload Window"],
        });
    });

    it("all failed — an error without a reload", () => {
        expect(describeUpdateAllResult({ updated: [], failed: [{ id: "acme.b", error: "offline" }] })).toEqual({
            severity: "error",
            message: "Updated 0 of 1 extensions. Failed: acme.b — offline",
            modal: false,
            items: [],
        });
    });

    it("nothing to update — says so", () => {
        expect(describeUpdateAllResult({ updated: [], failed: [] })).toEqual({
            severity: "info",
            message: "All extensions are up to date.",
            modal: false,
            items: [],
        });
    });
});

describe("hasOutdatedExtensions (US-2.9)", () => {
    it("is right from construction when the catalog is already read", () => {
        const h = harness();
        h.setOutdated([entry("acme.tools")]);
        const contextKeys = new ContextKeyService();

        new ExtensionUpdateContribution(h.service, contextKeys).dispose();

        expect(contextKeys.evaluate("hasOutdatedExtensions")).toBe(true);
    });

    it("follows the outdated list of the service, false until the catalog says otherwise", () => {
        const h = harness();
        const contextKeys = new ContextKeyService();
        const contribution = new ExtensionUpdateContribution(h.service, contextKeys);
        expect(contextKeys.evaluate("hasOutdatedExtensions")).toBe(false);

        h.setOutdated([entry("acme.tools")]);
        expect(contextKeys.evaluate("hasOutdatedExtensions")).toBe(true);

        h.setOutdated([]);
        expect(contextKeys.evaluate("hasOutdatedExtensions")).toBe(false);

        contribution.dispose();
        h.setOutdated([entry("acme.tools")]);
        expect(contextKeys.evaluate("hasOutdatedExtensions")).toBe(false);
    });
});
