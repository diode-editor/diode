import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import {
    type IRegistryExtensionMeta,
    REGISTRY_SCHEMA_VERSION,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IViewDescriptor, ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane } from "./extensionEditorPane.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";
import {
    EXTENSIONS_INSTALLED_VIEW_ID,
    EXTENSIONS_VIEW_ID,
    ExtensionsComponent,
    type IExtensionsEditorTarget,
} from "./extensionsComponent.ts";

const NULL_VIEWS_SERVICE = { registerContainer: () => {}, registerView: () => {} } as unknown as ViewsService;

function recordingViewsService(): { service: ViewsService; views: IViewDescriptor[] } {
    const views: IViewDescriptor[] = [];
    const service = {
        registerContainer: () => {},
        registerView: (d: IViewDescriptor) => views.push(d),
    } as unknown as ViewsService;
    return { service, views };
}

function viewById(views: readonly IViewDescriptor[], id: string): IViewDescriptor {
    const view = views.find((v) => v.id === id);
    expect(view, `view ${id} is not registered`).toBeDefined();
    return view!;
}

/** `workbench.list.openMode` only; the component reads nothing else. */
function fakeConfiguration(openMode: "singleClick" | "doubleClick" = "singleClick"): {
    service: IConfigurationService;
    set: (mode: "singleClick" | "doubleClick") => void;
} {
    let current = openMode;
    const service = {
        get: (key: string) => (key === "workbench.list.openMode" ? current : undefined),
    } as unknown as IConfigurationService;
    return {
        service,
        set: (mode) => {
            current = mode;
        },
    };
}

function entry(overrides: Partial<IExtensionListEntry> & { id: string }): IExtensionListEntry {
    const [publisher, name] = overrides.id.split(".");
    return {
        publisher: publisher,
        name: name,
        displayName: name,
        description: "",
        kind: "native",
        support: undefined,
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        pinned: false,
        categories: [],
        tags: [],
        needsReload: false,
        ...overrides,
    };
}

class FakeService implements IExtensionsWorkbenchService {
    public ensureLoadedCalls = 0;
    public refreshCalls = 0;
    public checkForUpdatesCalls = 0;
    public metaError: Error | null = null;
    private entries: IExtensionListEntry[];
    private error: string | null;
    private readonly listeners = new Set<() => void>();

    public constructor(
        entries: IExtensionListEntry[] = [],
        error: string | null = null,
        private readonly metas: Record<string, IRegistryExtensionMeta> = {},
    ) {
        this.entries = entries;
        this.error = error;
    }

    public ensureLoaded(): Promise<void> {
        this.ensureLoadedCalls++;
        return Promise.resolve();
    }

    public refresh(): Promise<void> {
        this.refreshCalls++;
        return Promise.resolve();
    }

    public checkForUpdates(): Promise<void> {
        this.checkForUpdatesCalls++;
        return Promise.resolve();
    }

    public getEntries(): readonly IExtensionListEntry[] {
        return this.entries;
    }

    public getOutdated(): readonly IExtensionListEntry[] {
        return this.entries.filter((e) => e.availability === "outdated");
    }

    public updateAll(): Promise<{ updated: []; failed: [] }> {
        return Promise.resolve({ updated: [], failed: [] });
    }

    public updateExtensions(): Promise<{ updated: []; failed: [] }> {
        return Promise.resolve({ updated: [], failed: [] });
    }

    public setPinned(): Promise<{ ok: true }> {
        return Promise.resolve({ ok: true });
    }

    public onDidReadCatalog(): { dispose: () => void } {
        return { dispose: () => undefined };
    }

    public installVsix(): Promise<never> {
        return Promise.reject(new Error("not used"));
    }

    public getCatalogError(): string | null {
        return this.error;
    }

    public getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (this.metaError !== null) return Promise.reject(this.metaError);
        return Promise.resolve(this.metas[id]);
    }

    // The viewlet doesn't install or uninstall: that lives on the extension page.
    public install(): Promise<{ ok: true; version: string }> {
        return Promise.resolve({ ok: true, version: "1.0.0" });
    }

    public uninstall(): Promise<{ ok: true }> {
        return Promise.resolve({ ok: true });
    }

    public getCompatibleVersions(): Promise<readonly []> {
        return Promise.resolve([]);
    }

    public onDidChange(listener: () => void): { dispose: () => void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    public update(entries: IExtensionListEntry[], error: string | null = null): void {
        this.entries = entries;
        this.error = error;
        for (const listener of [...this.listeners]) listener();
    }
}

function fakeTarget(): { target: IExtensionsEditorTarget; opened: IEditorPane[] } {
    const opened: IEditorPane[] = [];
    return { target: { openPane: (pane) => opened.push(pane) }, opened };
}

const PAGE_ACTIONS: IExtensionPageActions = {
    install: () => Promise.resolve({ ok: true, version: "1.0.0" }),
    uninstall: () => Promise.resolve({ ok: true }),
    pickVersion: () => Promise.resolve(undefined),
    reloadWindow: () => {},
    setAutoUpdate: () => Promise.resolve({ ok: true }),
    isAutoUpdateEnabled: () => true,
    onDidChangeAutoUpdate: () => ({ dispose: () => {} }),
};

function make(
    service: IExtensionsWorkbenchService,
    target: IExtensionsEditorTarget = fakeTarget().target,
    configuration: IConfigurationService = fakeConfiguration().service,
): ExtensionsComponent {
    return new ExtensionsComponent(service, NULL_VIEWS_SERVICE, target, PAGE_ACTIONS, configuration);
}

/** The MARKETPLACE section: the search box and the catalog. */
function render(component: ExtensionsComponent, w = 44, h = 16): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

function renderInstalled(component: ExtensionsComponent, w = 44, h = 16): MockTerminalBackend {
    return renderElement(component.installedSectionView, w, h, { themeVars: true });
}

/** Both sections' text, MARKETPLACE first. */
function screenOfBoth(component: ExtensionsComponent, w = 44): string {
    return render(component, w).screenToString() + "\n" + renderInstalled(component, w).screenToString();
}

function typeQuery(component: ExtensionsComponent, text: string): void {
    const input = component.view.querySelectorAll("InputElement")[0] as InputElement;
    input.inputState.value = text;
    input.onChange?.(text);
}

function activate(list: ListViewElement, rowId: string): void {
    const row = list.querySelector(`#${rowId}`);
    expect(row, `row #${rowId} not found`).not.toBeNull();
    list.onActivate?.(row!);
}

function mouse(list: ListViewElement, type: "click" | "dblclick", localY: number): void {
    list.dispatchEvent(new TUIMouseEvent(type, { button: "left", screenX: 3, screenY: localY, localX: 3, localY }));
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("ExtensionsComponent", () => {
    it("the marketplace container accepts no foreign views", () => {
        const containers: { id: string; rejectAddedViews?: boolean }[] = [];
        const views = {
            registerContainer: (d: { id: string; rejectAddedViews?: boolean }) => containers.push(d),
            registerView: () => {},
        } as unknown as ViewsService;
        new ExtensionsComponent(
            new FakeService([]),
            views,
            fakeTarget().target,
            PAGE_ACTIONS,
            fakeConfiguration().service,
        );
        expect(containers).toHaveLength(1);
        expect(containers[0].rejectAddedViews).toBe(true);
    });

    it("registers two sections: MARKETPLACE with the search box above INSTALLED", () => {
        const { service, views } = recordingViewsService();
        const component = new ExtensionsComponent(
            new FakeService([]),
            service,
            fakeTarget().target,
            PAGE_ACTIONS,
            fakeConfiguration().service,
        );

        const marketplace = viewById(views, EXTENSIONS_VIEW_ID);
        const installed = viewById(views, EXTENSIONS_INSTALLED_VIEW_ID);
        expect(marketplace.title).toBe("MARKETPLACE");
        expect(marketplace.body).toBe(component.view);
        expect(installed.title).toBe("INSTALLED");
        expect(installed.body).toBe(component.installedSectionView);
        expect(marketplace.containerId).toBe(installed.containerId);
        expect(marketplace.order).toBeLessThan(installed.order);
    });

    it("the lists and the roots carry their ids and sidebar colors", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));
        expect(component.view.id).toBe("extensionsView");
        expect(component.list.id).toBe("extensionsList");
        expect(component.installedSectionView.id).toBe("extensionsInstalledView");
        expect(component.installedList.id).toBe("extensionsInstalledList");

        // The viewlet background is the sidebar token, not the inherited editor background.
        const sideBar = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("sideBar.background");
        expect(render(component).getBgAt(new Point(0, 0))).toBe(sideBar);
        expect(renderInstalled(component).getBgAt(new Point(0, 0))).toBe(sideBar);
    });

    it("the search box is not flush with the panel edges", () => {
        const component = make(new FakeService([]));
        const line = render(component).screenToString().split("\n")[0];
        expect(line.startsWith(" ")).toBe(true);
        expect(line.endsWith(" ")).toBe(true);
    });

    it("an entry is three lines — name, description, publisher — with a line under it", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools", description: "Tools for acme" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const lines = render(make(service)).screenToString().split("\n");

        // Line 0 is the search box; the entries keep a one-column gutter.
        expect(lines.slice(1, 4).map((l) => l.trimEnd())).toEqual([" Acme Tools  1.0.0", " Tools for acme", " acme"]);
        expect(lines[4]).toMatch(/^─{10}/);
        expect(lines[5].trimEnd()).toBe(" Other Thing  1.0.0");
    });

    it("the separator is dimmer than the entries", () => {
        const screen = render(make(new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })])));
        expect(screen.getFgAt(new Point(5, 4))).not.toBe(screen.getFgAt(new Point(1, 1)));
    });

    it("a click on a lower line of an entry selects the whole entry", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const component = make(service, fakeTarget().target, fakeConfiguration("doubleClick").service);
        render(component);

        mouse(component.list, "click", 6);

        expect(component.list.getCursorElement()?.id).toBe("extensionsGroup-marketplace-other-thing");
    });

    it("letters in the list are not typeahead: the cursor stays put", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const component = make(service);
        render(component);
        component.list.setCursorTo("extensionsGroup-marketplace-acme-tools");

        component.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "o" }));
        expect(component.list.getCursorElement()?.id).toBe("extensionsGroup-marketplace-acme-tools");
    });

    it("letters in the INSTALLED list are not typeahead either", () => {
        const installed = { installedVersion: "1.0.0", availability: "installed" } as const;
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools", ...installed }),
            entry({ id: "other.thing", displayName: "Other Thing", ...installed }),
        ]);
        const component = make(service);
        renderInstalled(component);
        component.installedList.setCursorTo("extensionsGroup-installed-acme-tools");

        component.installedList.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "o" }));
        expect(component.installedList.getCursorElement()?.id).toBe("extensionsGroup-installed-acme-tools");
    });

    it("INSTALLED with entries has no empty-state row", () => {
        const component = make(
            new FakeService([entry({ id: "acme.tools", installedVersion: "1.0.0", availability: "installed" })]),
        );
        expect(component.installedList.querySelector("#extensionsInstalledEmpty")).toBeNull();
        expect(renderInstalled(component).screenToString()).not.toContain("No extensions found");
    });

    it("a state row keeps the entries' one-column gutter", () => {
        const lines = render(make(new FakeService([])))
            .screenToString()
            .split("\n");
        expect(lines[1].startsWith(" No extensions found")).toBe(true);
    });

    it("an entry's first line carries its own id for the inspector", () => {
        const component = make(new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]));
        const title = component.list.querySelector("#extensionsGroup-marketplace-acme-tools--title");
        expect((title as TextLabelElement | null)?.getText()).toBe("Acme Tools  1.0.0");
    });

    it("installed extensions outside the registry do not go into the catalog, and uninstalled registry ones do not go into INSTALLED", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({
                id: "local.helper",
                displayName: "Helper",
                latestVersion: null,
                installedVersion: "0.1.0",
                availability: "installed",
            }),
        ]);
        const component = make(service);

        expect(component.list.querySelector("#extensionsGroup-marketplace-acme-tools")).not.toBeNull();
        expect(component.list.querySelector("#extensionsGroup-marketplace-local-helper")).toBeNull();
        expect(component.installedList.querySelector("#extensionsGroup-installed-local-helper")).not.toBeNull();
        expect(component.installedList.querySelector("#extensionsGroup-installed-acme-tools")).toBeNull();
    });

    it("the empty state is shown only when the list is really empty", () => {
        const component = make(new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]));
        expect(render(component).screenToString()).not.toContain("No extensions found");
    });

    it("a state row carries no cursor", () => {
        const component = make(new FakeService([]));
        render(component);
        renderInstalled(component);

        expect(component.list.getCursorElement()).toBeNull();
        expect(component.installedList.getCursorElement()).toBeNull();
    });

    it("rows of the previous contents leave no actions behind", async () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const { target, opened } = fakeTarget();
        const component = make(service, target);
        const staleRowId = "extensionsGroup-marketplace-acme-tools";

        // The entry is still in the service, but the filter removed its row, so
        // the row's action must disappear together with it.
        typeQuery(component, "other");
        component.list.onActivate?.({ id: staleRowId } as TUIElement);
        await settle();
        expect(opened).toHaveLength(0);
        // And there is no reason to reload the catalog: a row that doesn't exist has no action.
        expect(service.refreshCalls).toBe(0);
    });

    it("shows the search box and the catalog in MARKETPLACE, installed ones in INSTALLED", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({
                id: "local.helper",
                displayName: "Helper",
                latestVersion: null,
                installedVersion: "0.1.0",
                availability: "installed",
            }),
        ]);
        const component = make(service);
        const marketplace = render(component).screenToString();
        const installed = renderInstalled(component).screenToString();

        expect(marketplace).toContain("Search Extensions");
        expect(marketplace).toContain("Acme Tools");
        expect(marketplace).not.toContain("Helper");
        expect(installed).toContain("Helper");
        expect(installed).not.toContain("Acme Tools");
    });

    it("an extension installed from the marketplace shows both in the catalog with a badge and in its own section", () => {
        const service = new FakeService([
            entry({
                id: "acme.tools",
                displayName: "Acme Tools",
                installedVersion: "1.0.0",
                availability: "installed",
            }),
        ]);
        const screen = screenOfBoth(make(service));

        expect(screen.match(/Acme Tools/g)).toHaveLength(2);
        expect(screen).toContain("Installed");
    });

    it("update and incompatibility badges are visible in the frame", () => {
        const service = new FakeService([
            entry({
                id: "acme.tools",
                displayName: "Tools",
                installedVersion: "0.9.0",
                latestVersion: "1.0.0",
                availability: "outdated",
            }),
            entry({ id: "acme.old", displayName: "Old", availability: "incompatible" }),
        ]);
        const screen = render(make(service), 60).screenToString();

        expect(screen).toContain("Update 1.0.0");
        expect(screen).toContain("Incompatible");
    });

    it("filters both sections as you type", () => {
        const service = new FakeService([
            entry({
                id: "acme.tools",
                displayName: "Acme Tools",
                installedVersion: "1.0.0",
                availability: "installed",
            }),
            entry({
                id: "other.thing",
                displayName: "Other Thing",
                installedVersion: "1.0.0",
                availability: "installed",
            }),
        ]);
        const component = make(service);

        typeQuery(component, "acme");
        const screen = screenOfBoth(component);
        expect(screen.match(/Acme Tools/g)).toHaveLength(2);
        expect(screen).not.toContain("Other Thing");
    });

    it("nothing found — says so in both sections", () => {
        const component = make(
            new FakeService([entry({ id: "acme.tools", installedVersion: "1.0.0", availability: "installed" })]),
        );

        typeQuery(component, "zzz");
        expect(render(component).screenToString()).toContain("No extensions found");
        expect(renderInstalled(component).screenToString()).toContain("No extensions found");
    });

    it("an empty catalog with nothing installed is the empty state too", () => {
        expect(screenOfBoth(make(new FakeService([]))).match(/No extensions found/g)).toHaveLength(2);
    });

    it("a catalog error is shown with its reason and offers a retry", () => {
        const service = new FakeService([], "getaddrinfo ENOTFOUND example.invalid");
        const screen = render(make(service), 70).screenToString();

        expect(screen).toContain("Retry");
        expect(screen).toContain("ENOTFOUND");
    });

    it("installed extensions are still visible on a catalog error", () => {
        const service = new FakeService(
            [
                entry({
                    id: "local.helper",
                    displayName: "Helper",
                    latestVersion: null,
                    installedVersion: "0.1.0",
                    availability: "installed",
                }),
            ],
            "offline",
        );
        const component = make(service);

        expect(render(component).screenToString()).toContain("Retry");
        expect(renderInstalled(component).screenToString()).toContain("Helper");
    });

    it("activating the error row rereads the catalog", () => {
        const service = new FakeService([], "offline");
        const component = make(service);

        activate(component.list, "extensionsRetry");
        expect(service.refreshCalls).toBe(1);
    });

    it("a service data change rebuilds the list", () => {
        const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
        const component = make(service);

        service.update([entry({ id: "other.thing", displayName: "Other Thing" })]);
        const screen = render(component).screenToString();
        expect(screen).toContain("Other Thing");
        expect(screen).not.toContain("Acme Tools");
    });

    it("the filter survives a data change", () => {
        const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
        const component = make(service);
        typeQuery(component, "acme");

        service.update([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const screen = render(component).screenToString();
        expect(screen).toContain("Acme Tools");
        expect(screen).not.toContain("Other Thing");
    });

    it("while the catalog loads — 'Loading', not 'nothing found'", async () => {
        let release = (): void => {};
        const service = new FakeService([]);
        service.ensureLoaded = () =>
            new Promise<void>((resolve) => {
                release = resolve;
            });
        const component = make(service);

        component.focus();
        expect(render(component).screenToString()).toContain("Loading extensions");

        release();
        await settle();
        expect(render(component).screenToString()).toContain("No extensions found");
    });

    it("showing the MARKETPLACE section moves to the search box and reads the catalog", () => {
        const service = new FakeService([entry({ id: "acme.tools" })]);
        const { service: views, views: registered } = recordingViewsService();
        new ExtensionsComponent(service, views, fakeTarget().target, PAGE_ACTIONS, fakeConfiguration().service);

        // The same path ViewsService uses to show the section (command, reveal).
        viewById(registered, EXTENSIONS_VIEW_ID).focus();
        expect(service.ensureLoadedCalls).toBe(1);
    });

    it("showing the INSTALLED section focuses its list", () => {
        const { service: views, views: registered } = recordingViewsService();
        const component = new ExtensionsComponent(
            new FakeService([entry({ id: "acme.tools", installedVersion: "1.0.0", availability: "installed" })]),
            views,
            fakeTarget().target,
            PAGE_ACTIONS,
            fakeConfiguration().service,
        );
        TestApp.createWithContent(component.installedSectionView).render();

        viewById(registered, EXTENSIONS_INSTALLED_VIEW_ID).focus();
        expect(component.installedList.isFocused).toBe(true);
    });

    it("focus reads the catalog: no network until the viewlet is shown", () => {
        const service = new FakeService([entry({ id: "acme.tools" })]);
        const component = make(service);
        expect(service.ensureLoadedCalls).toBe(0);

        component.focus();
        expect(service.ensureLoadedCalls).toBe(1);
    });

    it("focus puts the cursor in the search box", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));
        TestApp.createWithContent(component.view).render();

        component.focus();
        expect((component.view.querySelectorAll("InputElement")[0] as InputElement).isFocused).toBe(true);
    });

    it("the component's refresh delegates to the service", async () => {
        const service = new FakeService([]);
        await make(service).refresh();
        expect(service.refreshCalls).toBe(1);
    });

    it("checkForUpdates delegates to the service behind the loading row", async () => {
        const service = new FakeService([]);
        const component = make(service);
        const pending = component.checkForUpdates();
        expect(render(component).screenToString()).toContain("Loading extensions…");
        await pending;
        expect(service.checkForUpdatesCalls).toBe(1);
        expect(render(component).screenToString()).toContain("No extensions found");
    });

    it("US-2.4/US-2.5: setQuery puts @outdated in the search box and the outdated ones show once, in INSTALLED", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Tools", installedVersion: "0.9.0", availability: "outdated" }),
            entry({ id: "acme.current", displayName: "Current", installedVersion: "1.0.0", availability: "installed" }),
            entry({ id: "acme.fresh", displayName: "Fresh" }),
        ]);
        const component = make(service);

        component.setQuery("@outdated ");

        expect(component.getQuery()).toBe("@outdated ");
        const marketplace = render(component, 60).screenToString();
        expect(marketplace).toContain("@outdated");
        // Outdated ones are installed by definition: the catalog stays empty, and that is not "nothing found".
        expect(marketplace).not.toContain("Tools");
        expect(marketplace).not.toContain("No extensions found");
        const screen = screenOfBoth(component, 60);
        expect(screen.match(/Tools/g)).toHaveLength(1);
        expect(screen).not.toContain("Current");
        expect(screen).not.toContain("Fresh");
    });

    it("@installed is one INSTALLED list, with the rest of the query applied", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Tools", installedVersion: "0.9.0", availability: "outdated" }),
            entry({ id: "acme.dark", displayName: "Dark", installedVersion: "1.0.0", availability: "installed" }),
            entry({ id: "acme.fresh", displayName: "Fresh" }),
        ]);
        const component = make(service);

        typeQuery(component, "@installed dark");

        // The catalog is empty by design, not "nothing found".
        const marketplace = render(component, 60).screenToString();
        expect(marketplace).not.toContain("Dark");
        expect(marketplace).not.toContain("No extensions found");
        const screen = screenOfBoth(component, 60);
        expect(screen.match(/Dark/g)).toHaveLength(1);
        expect(screen).not.toContain("Tools");
        expect(screen).not.toContain("Fresh");
    });

    it("@category:themes keeps both sections, each narrowed to themes", () => {
        const service = new FakeService([
            entry({ id: "acme.night", displayName: "Night", categories: ["Themes"] }),
            entry({
                id: "acme.dawn",
                displayName: "Dawn",
                categories: ["Themes"],
                installedVersion: "1.0.0",
                availability: "installed",
            }),
            entry({ id: "acme.lint", displayName: "Linter", categories: ["Linters"] }),
        ]);
        const component = make(service);

        component.setQuery('@category:"themes"');

        expect(render(component, 60).screenToString()).toContain("Night");
        const screen = screenOfBoth(component, 60);
        // In the catalog and in INSTALLED.
        expect(screen.match(/Dawn/g)).toHaveLength(2);
        expect(screen).not.toContain("Linter");
    });

    it("US-2.4: under @outdated the catalog error row stays visible", () => {
        const component = make(new FakeService([], "offline"));
        component.setQuery("@outdated ");
        expect(render(component, 60).screenToString()).toContain("Retry — offline");
    });

    describe("opening the page", () => {
        const meta: IRegistryExtensionMeta = {
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            id: "acme.tools",
            publisher: "acme",
            name: "tools",
            displayName: "Acme Tools",
            description: "",
            kind: "native",
            support: undefined,
            readme: "Readme body",
            versions: [],
        };

        it("Enter on an entry opens the extension tab", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })], null, {
                "acme.tools": meta,
            });
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            activate(component.list, "extensionsGroup-marketplace-acme-tools");
            await settle();

            expect(opened).toHaveLength(1);
            expect(opened[0]).toBeInstanceOf(ExtensionEditorPane);
            expect(opened[0]?.uri.toString()).toBe("extension:acme.tools");
            expect(opened[0]?.label).toBe("Acme Tools");
        });

        it("a single click on any line of an entry opens it", async () => {
            const service = new FakeService([
                entry({ id: "acme.tools", displayName: "Acme Tools" }),
                entry({ id: "other.thing", displayName: "Other Thing" }),
            ]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);
            render(component);

            // List line 6 is the second entry's publisher: the first entry and the separator take lines 0..3.
            mouse(component.list, "click", 6);
            await settle();

            expect(opened.map((p) => p.uri.toString())).toEqual(["extension:other.thing"]);
        });

        it("a single click on an INSTALLED entry opens it too", async () => {
            const service = new FakeService([
                entry({
                    id: "acme.tools",
                    displayName: "Acme Tools",
                    installedVersion: "1.0.0",
                    availability: "installed",
                }),
            ]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);
            renderInstalled(component);

            mouse(component.installedList, "click", 1);
            await settle();

            expect(opened.map((p) => p.uri.toString())).toEqual(["extension:acme.tools"]);
        });

        it("with workbench.list.openMode = doubleClick a single click only selects, a double click opens", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            const { target, opened } = fakeTarget();
            const configuration = fakeConfiguration("doubleClick");
            const component = make(service, target, configuration.service);
            render(component);

            mouse(component.list, "click", 0);
            await settle();
            expect(component.list.getCursorElement()?.id).toBe("extensionsGroup-marketplace-acme-tools");
            expect(opened).toHaveLength(0);

            mouse(component.list, "dblclick", 0);
            await settle();
            expect(opened).toHaveLength(1);
        });

        it("the open mode is read on every click", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            const { target, opened } = fakeTarget();
            const configuration = fakeConfiguration("doubleClick");
            const component = make(service, target, configuration.service);
            render(component);

            configuration.set("singleClick");
            mouse(component.list, "click", 0);
            await settle();

            expect(opened).toHaveLength(1);
        });

        it("the page carries the readme from the metadata", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })], null, {
                "acme.tools": meta,
            });
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            await component.openExtensionPage("acme.tools");
            expect(renderElement(opened[0].view, 40, 20, { themeVars: true }).screenToString()).toContain(
                "Readme body",
            );
        });

        it("a metadata read failure does not leave an empty tab — the reason is on the page", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            service.metaError = new Error("fetch failed (ENOTFOUND)");
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            await component.openExtensionPage("acme.tools");
            expect(renderElement(opened[0].view, 70, 20, { themeVars: true }).screenToString()).toContain("ENOTFOUND");
        });

        it("an entry from the installed section opens the same tab", async () => {
            const service = new FakeService([
                entry({
                    id: "acme.tools",
                    displayName: "Acme Tools",
                    installedVersion: "1.0.0",
                    availability: "installed",
                }),
            ]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            activate(component.installedList, "extensionsGroup-installed-acme-tools");
            await settle();
            expect(opened[0]?.uri.toString()).toBe("extension:acme.tools");
        });

        it("a state row opens nothing", async () => {
            const { target, opened } = fakeTarget();
            const component = make(new FakeService([]), target);

            activate(component.list, "extensionsEmpty");
            activate(component.installedList, "extensionsInstalledEmpty");
            await settle();
            expect(opened).toHaveLength(0);
        });

        it("a non-Error registry refusal also arrives as text", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the suite checks a non-Error rejection SPECIFICALLY
            service.getMeta = () => Promise.reject("registry said no");
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            await component.openExtensionPage("acme.tools");
            expect(renderElement(opened[0].view, 70, 20, { themeVars: true }).screenToString()).toContain(
                "registry said no",
            );
        });

        it("an unknown id opens no tab, even when there are cards", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            // An id miss must be a miss, not "the first entry that comes along".
            await component.openExtensionPage("acme.gone");
            expect(opened).toHaveLength(0);
        });
    });
});
