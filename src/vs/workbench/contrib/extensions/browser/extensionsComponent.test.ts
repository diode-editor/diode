import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import {
    type IRegistryExtensionMeta,
    REGISTRY_SCHEMA_VERSION,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane } from "./extensionEditorPane.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";
import { ExtensionsComponent, type IExtensionsEditorTarget } from "./extensionsComponent.ts";

const NULL_VIEWS_SERVICE = { registerContainer: () => {}, registerView: () => {} } as unknown as ViewsService;

function recordingViewsService(): { service: ViewsService; descriptor: () => { focus: () => void; title: string } } {
    let captured: { focus: () => void; title: string } | undefined;
    const service = {
        registerContainer: () => {},
        registerView: (d: { focus: () => void; title: string }) => {
            captured = d;
        },
    } as unknown as ViewsService;
    return {
        service,
        descriptor: () => {
            expect(captured, "view is not registered").toBeDefined();
            return captured!;
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
        needsReload: false,
        ...overrides,
    };
}

class FakeService implements IExtensionsWorkbenchService {
    public ensureLoadedCalls = 0;
    public refreshCalls = 0;
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

    public getEntries(): readonly IExtensionListEntry[] {
        return this.entries;
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
    reloadWindow: () => {},
};

function make(
    service: IExtensionsWorkbenchService,
    target: IExtensionsEditorTarget = fakeTarget().target,
): ExtensionsComponent {
    return new ExtensionsComponent(service, NULL_VIEWS_SERVICE, target, PAGE_ACTIONS);
}

function render(component: ExtensionsComponent, w = 44, h = 16): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

function typeQuery(component: ExtensionsComponent, text: string): void {
    const input = component.view.querySelectorAll("InputElement")[0] as InputElement;
    input.inputState.value = text;
    input.onChange?.(text);
}

function activate(component: ExtensionsComponent, rowId: string): void {
    const row = component.view.querySelector(`#${rowId}`);
    expect(row, `row #${rowId} not found`).not.toBeNull();
    component.list.onActivate?.(row!);
}

describe("ExtensionsComponent", () => {
    it("the marketplace container accepts no foreign views", () => {
        const containers: { id: string; rejectAddedViews?: boolean }[] = [];
        const views = {
            registerContainer: (d: { id: string; rejectAddedViews?: boolean }) => containers.push(d),
            registerView: () => {},
        } as unknown as ViewsService;
        new ExtensionsComponent(new FakeService([]), views, fakeTarget().target, PAGE_ACTIONS);
        expect(containers).toHaveLength(1);
        expect(containers[0].rejectAddedViews).toBe(true);
    });

    it("the list and the root carry their ids and sidebar colors", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));
        expect(component.view.id).toBe("extensionsView");
        expect(component.list.id).toBe("extensionsList");

        // The viewlet background is the sidebar token, not the inherited editor background.
        const screen = render(component);
        const sideBar = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("sideBar.background");
        expect(screen.getBgAt(new Point(0, 0))).toBe(sideBar);
    });

    it("the search box is not flush with the panel edges", () => {
        const component = make(new FakeService([]));
        const line = render(component).screenToString().split("\n")[0];
        expect(line.startsWith(" ")).toBe(true);
        expect(line.endsWith(" ")).toBe(true);
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

    it("entries sit under their groups — a collapsed group hides them", () => {
        const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
        const component = make(service);
        expect(render(component).screenToString()).toContain("Acme Tools");

        component.list.setCollapsed("extensionsGroup-marketplace", true);
        expect(render(component).screenToString()).not.toContain("Acme Tools");
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
        render(component);

        expect(component.view.querySelector("#extensionsGroup-marketplace-acme-tools")).not.toBeNull();
        expect(component.view.querySelector("#extensionsGroup-marketplace-local-helper")).toBeNull();
        expect(component.view.querySelector("#extensionsGroup-installed-local-helper")).not.toBeNull();
        expect(component.view.querySelector("#extensionsGroup-installed-acme-tools")).toBeNull();
    });

    it("the empty state is shown only when the list is really empty", () => {
        const component = make(new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]));
        expect(render(component).screenToString()).not.toContain("No extensions found");
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
        await Promise.resolve();
        await Promise.resolve();
        expect(opened).toHaveLength(0);
        // And there is no reason to reload the catalog: a row that doesn't exist has no action.
        expect(service.refreshCalls).toBe(0);
    });

    it("shows the search box, the catalog and the installed section", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "local.helper", displayName: "Helper", installedVersion: "0.1.0", availability: "installed" }),
        ]);
        const screen = render(make(service)).screenToString();

        expect(screen).toContain("Search Extensions");
        expect(screen).toContain("MARKETPLACE");
        expect(screen).toContain("Acme Tools");
        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Helper");
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
        const component = make(service);
        const screen = render(component).screenToString();

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

    it("filters as you type", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const component = make(service);

        typeQuery(component, "acme");
        const screen = render(component).screenToString();
        expect(screen).toContain("Acme Tools");
        expect(screen).not.toContain("Other Thing");
    });

    it("nothing found — says so", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));

        typeQuery(component, "zzz");
        expect(render(component).screenToString()).toContain("No extensions found");
    });

    it("an empty catalog with nothing installed is the empty state too", () => {
        expect(render(make(new FakeService([]))).screenToString()).toContain("No extensions found");
    });

    it("a catalog error is shown with its reason and offers a retry", () => {
        const service = new FakeService([], "getaddrinfo ENOTFOUND example.invalid");
        const screen = render(make(service), 70).screenToString();

        // The section title stays: the error is a catalog state, not its replacement.
        expect(screen).toContain("MARKETPLACE");
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
        const screen = render(make(service)).screenToString();

        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Helper");
    });

    it("the error row sits under the catalog header", () => {
        const component = make(new FakeService([], "offline"));
        expect(render(component, 70).screenToString()).toContain("Retry");

        // A collapsed catalog hides the failure reason too: the row belongs to the section.
        component.list.setCollapsed("extensionsGroup-marketplace", true);
        expect(render(component, 70).screenToString()).not.toContain("Retry");
    });

    it("activating the error row rereads the catalog", () => {
        const service = new FakeService([], "offline");
        const component = make(service);

        activate(component, "extensionsRetry");
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
        await Promise.resolve();
        await Promise.resolve();
        expect(render(component).screenToString()).toContain("No extensions found");
    });

    it("showing the section moves to the search box and reads the catalog", () => {
        const service = new FakeService([entry({ id: "acme.tools" })]);
        const views = recordingViewsService();
        const component = new ExtensionsComponent(service, views.service, fakeTarget().target, PAGE_ACTIONS);

        // The same path ViewsService uses to show the section (command, reveal).
        views.descriptor().focus();
        expect(service.ensureLoadedCalls).toBe(1);
        expect(views.descriptor().title).toBe("EXTENSIONS");
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

            activate(component, "extensionsGroup-marketplace-acme-tools");
            await Promise.resolve();
            await Promise.resolve();

            expect(opened).toHaveLength(1);
            expect(opened[0]).toBeInstanceOf(ExtensionEditorPane);
            expect(opened[0]?.uri.toString()).toBe("extension:acme.tools");
            expect(opened[0]?.label).toBe("Acme Tools");
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

            activate(component, "extensionsGroup-installed-acme-tools");
            await Promise.resolve();
            await Promise.resolve();
            expect(opened[0]?.uri.toString()).toBe("extension:acme.tools");
        });

        it("Enter on a group header opens nothing", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            activate(component, "extensionsGroup-marketplace");
            await Promise.resolve();
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
