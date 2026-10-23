import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";
import type { IExtensionInstallResult, IExtensionOperationResult } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane, extensionUri } from "./extensionEditorPane.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        support: undefined,
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        pinned: false,
        needsReload: false,
        ...overrides,
    };
}

function fakeService(initial: IExtensionListEntry[]): {
    service: IExtensionsWorkbenchService;
    update: (entries: IExtensionListEntry[]) => void;
} {
    let entries = initial;
    const listeners = new Set<() => void>();
    const service: IExtensionsWorkbenchService = {
        ensureLoaded: () => Promise.resolve(),
        refresh: () => Promise.resolve(),
        getEntries: () => entries,
        getCatalogError: () => null,
        getMeta: () => Promise.resolve(undefined),
        checkForUpdates: () => Promise.resolve(),
        getOutdated: () => [],
        updateAll: () => Promise.resolve({ updated: [], failed: [] }),
        updateExtensions: () => Promise.resolve({ updated: [], failed: [] }),
        setPinned: () => Promise.resolve({ ok: true }),
        onDidReadCatalog: () => ({ dispose: () => undefined }),
        getCompatibleVersions: () => Promise.resolve([]),
        install: () => Promise.resolve({ ok: true, version: "1.0.0" }),
        uninstall: () => Promise.resolve({ ok: true }),
        onDidChange: (listener) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
    };
    return {
        service,
        update: (next) => {
            entries = next;
            for (const listener of [...listeners]) listener();
        },
    };
}

const META: IRegistryExtensionMeta = {
    schemaVersion: 1,
    id: "acme.tools",
    publisher: "acme",
    name: "tools",
    displayName: "Acme Tools",
    description: "Tools for acme",
    kind: "native",
    support: undefined,
    readme: "Readme body",
    versions: [],
};

function fakeActions(
    results: {
        install?: IExtensionInstallResult;
        uninstall?: IExtensionOperationResult;
        /** `Error` rejects. */
        pick?: string | undefined | Error;
        setAutoUpdate?: IExtensionOperationResult;
    } = {},
): IExtensionPageActions & { calls: string[]; setAutoUpdateSetting: (enabled: boolean) => void } {
    const calls: string[] = [];
    let autoUpdate = true;
    const autoUpdateChanged = new Emitter<void>();
    return {
        calls,
        setAutoUpdateSetting: (enabled) => {
            autoUpdate = enabled;
            autoUpdateChanged.fire();
        },
        setAutoUpdate: (id, enabled) => {
            calls.push(`autoUpdate:${id}:${String(enabled)}`);
            return Promise.resolve(results.setAutoUpdate ?? { ok: true });
        },
        isAutoUpdateEnabled: () => autoUpdate,
        onDidChangeAutoUpdate: autoUpdateChanged.event,
        install: (id, options) => {
            calls.push(options?.version === undefined ? `install:${id}` : `install:${id}@${options.version}`);
            return Promise.resolve(results.install ?? { ok: true, version: options?.version ?? "1.0.0" });
        },
        pickVersion: (id) => {
            calls.push(`pick:${id}`);
            return results.pick instanceof Error ? Promise.reject(results.pick) : Promise.resolve(results.pick);
        },
        uninstall: (id) => {
            calls.push(`uninstall:${id}`);
            return Promise.resolve(results.uninstall ?? { ok: true });
        },
        reloadWindow: () => {
            calls.push("reload");
        },
    };
}

/** Mounts the page in an app: focus and events live in the app tree. */
function mount(pane: ExtensionEditorPane): void {
    TestApp.createWithContent(pane.view).render();
}

function press(pane: ExtensionEditorPane, kind: string): Promise<void> {
    pressSync(pane, kind);
    // The operation is async: let the install/uninstall promise settle.
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function pressSync(pane: ExtensionEditorPane, kind: string): void {
    const button = pane.view.querySelector(`#extensionPageButton-${kind}`)!;
    button.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
}

function buttonLabels(pane: ExtensionEditorPane): string[] {
    const buttons = headerState(pane).buttons as { label: string }[];
    return buttons.map((b) => b.label);
}

function enabledFlags(pane: ExtensionEditorPane): boolean[] {
    const buttons = headerState(pane).buttons as { enabled: boolean }[];
    return buttons.map((b) => b.enabled);
}

function headerLines(pane: ExtensionEditorPane): string[] {
    return headerState(pane).lines as string[];
}

function headerState(pane: ExtensionEditorPane): Record<string, unknown> {
    return pane.view.querySelector("#extensionPageHeader")!.inspectState()!;
}

function screenOf(pane: ExtensionEditorPane, w = 50, h = 20): string {
    return renderElement(pane.view, w, h, { themeVars: true }).screenToString();
}

describe("ExtensionEditorPane", () => {
    it("the tab resource is the extension id under the extension scheme", () => {
        expect(extensionUri("acme.tools").toString()).toBe("extension:acme.tools");
    });

    it("the tab label is the displayName, editing is disallowed", () => {
        const { service } = fakeService([entry()]);
        const pane: IEditorPane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);

        expect(pane.label).toBe("Acme Tools");
        expect(pane.readOnly).toBe(true);
        expect(pane.isModified).toBe(false);
        // The page has no text projection, so cursor commands do not see it.
        expect(pane.viewState).toBeUndefined();
        expect(pane.getSelectedTexts()).toEqual([]);
    });

    it("the pane carries an id and editor colors — the tab is visible to the inspector", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        renderElement(pane.view, 50, 20, { themeVars: true });

        // The inspector selector does not understand dots in the id, so they are replaced with dashes.
        expect(pane.view.id).toBe("extensionPage-acme-tools");
        expect(pane.view.style).toMatchObject({ fg: "editor.foreground", bg: "editor.background" });
    });

    it("the page shows the header and readme", () => {
        const { service } = fakeService([entry()]);
        const screen = screenOf(new ExtensionEditorPane(service, fakeActions(), entry(), META, null));

        expect(screen).toContain("Acme Tools");
        expect(screen).toContain("acme.tools");
        expect(screen).toContain("Not installed");
        expect(screen).toContain("Readme body");
    });

    it("the metadata and the reason it is missing survive a card update", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), undefined, "boom");

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);
        const screen = screenOf(pane, 70);
        expect(screen).toContain("Installed 1.0.0");
        // The failure reason survives a re-render; otherwise the page silently goes blank.
        expect(screen).toContain("boom");
    });

    it("an extension state change reaches the open page", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        expect(screenOf(pane)).toContain("Not installed");

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);
        expect(screenOf(pane)).toContain("Installed 1.0.0");
    });

    it("the page tracks its own card, not the first one in the list", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);

        update([
            entry({ id: "other.thing", displayName: "Other", installedVersion: "9.9.9", availability: "installed" }),
            entry(),
        ]);
        // Another entry changed; our status stays the same.
        expect(screenOf(pane)).toContain("Not installed");
    });

    it("a vanished card does not break the page — the last known state stays", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);

        update([]);
        expect(screenOf(pane)).toContain("Acme Tools");
    });

    it("a displayName change redraws the tab", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        });

        update([entry({ displayName: "Renamed" })]);
        expect(pane.label).toBe("Renamed");
        expect(stateChanges).toBe(1);
    });

    it("an unchanged tab name causes no extra redraws", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        });

        update([entry({ availability: "installed", installedVersion: "1.0.0" })]);
        expect(stateChanges).toBe(0);
    });

    it("the label change subscription is removed by its dispose", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        }).dispose();

        update([entry({ displayName: "Renamed" })]);
        expect(stateChanges).toBe(0);
    });

    it("after dispose the pane ignores service events", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        pane.dispose();

        update([entry({ displayName: "Renamed" })]);
        expect(pane.label).toBe("Acme Tools");
    });

    it("the page exposes its lines to the inspector — e2e asserts on them", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        renderElement(pane.view, 50, 20, { themeVars: true });

        // Header and body are separate elements, each with its own line snapshot.
        const header = pane.view.querySelector("#extensionPageHeader")!;
        expect((header.inspectState()!.lines as string[]).slice(0, 2)).toEqual(["Acme Tools", "acme.tools"]);
        expect(pane.view.inspectState()?.lines as string[]).toContain("Readme body");
    });

    it("focusEditor gives focus to the first action — that is where this page starts", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        const app = TestApp.createWithContent(pane.view);
        app.render();

        pane.focusEditor();
        expect(pane.view.querySelector("#extensionPageButton-install")?.isFocused).toBe(true);
    });

    it("Install installs the extension and asks to reload the window", async () => {
        const { service } = fakeService([entry()]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
        mount(pane);

        await press(pane, "install");

        expect(actions.calls).toEqual(["install:acme.tools"]);
        // The install button is replaced by the reload prompt and focus is on it:
        // that is the next step, no need to search the command palette.
        expect(buttonLabels(pane)).toEqual(["Reload Window", "Install", "Install Specific Version..."]);
        expect(pane.view.querySelector("#extensionPageButton-reload")?.isFocused).toBe(true);
    });

    it("Update is the same install: there is no separate update operation", async () => {
        const outdated = entry({ installedVersion: "0.9.0", availability: "outdated" });
        const { service } = fakeService([outdated]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, outdated, META, null);
        mount(pane);

        await press(pane, "update");

        expect(actions.calls).toEqual(["install:acme.tools"]);
    });

    it("Uninstall removes and also asks for a reload", async () => {
        const installed = entry({ installedVersion: "1.0.0", availability: "installed" });
        const { service } = fakeService([installed]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, installed, META, null);
        mount(pane);

        await press(pane, "uninstall");

        expect(actions.calls).toEqual(["uninstall:acme.tools"]);
        expect(buttonLabels(pane)).toContain("Reload Window");
    });

    it("an install error stays on the page and the button is enabled again", async () => {
        const { service } = fakeService([entry()]);
        const actions = fakeActions({ install: { ok: false, error: "sha256 mismatch" } });
        const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
        mount(pane);

        await press(pane, "install");

        expect(headerLines(pane)).toContain("sha256 mismatch");
        // Nothing changed, so no reload is needed; retry is available right away.
        expect(buttonLabels(pane)).toEqual(["Install", "Install Specific Version..."]);
        expect(enabledFlags(pane)).toEqual([true, true]);
    });

    it("buttons are disabled during an operation — a second install cannot start", async () => {
        const { service } = fakeService([entry()]);
        let finish = (): void => {};
        const actions: IExtensionPageActions = {
            ...fakeActions(),
            install: () =>
                new Promise((resolve) => {
                    finish = () => {
                        resolve({ ok: true, version: "1.0.0" });
                    };
                }),
        };
        const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
        mount(pane);

        const running = press(pane, "install");
        expect(enabledFlags(pane)).toEqual([false, false]);

        finish();
        await running;
        expect(enabledFlags(pane)).toEqual([true, true, true]);
    });

    it("a pending reload also comes from the card — installed from elsewhere", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        mount(pane);

        update([entry({ installedVersion: "1.0.0", availability: "installed", needsReload: true })]);

        expect(buttonLabels(pane)).toEqual([
            "Reload Window",
            "Install Specific Version...",
            "Uninstall",
            "[x] Auto Update",
        ]);
    });

    it("an unrelated card update does not invent a pending reload", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        mount(pane);

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);

        // Installed elsewhere and not in this session, so no reload is needed.
        expect(buttonLabels(pane)).toEqual(["Install Specific Version...", "Uninstall", "[x] Auto Update"]);
    });

    describe("Install Specific Version... (ExtensionUpdates stage 1)", () => {
        it("US-1.2: the picked version is installed and the page asks to reload", async () => {
            const installed = entry({ installedVersion: "1.1.0", latestVersion: "1.1.0", availability: "installed" });
            const { service } = fakeService([installed]);
            const actions = fakeActions({ pick: "1.0.0" });
            const pane = new ExtensionEditorPane(service, actions, installed, META, null);
            mount(pane);

            await press(pane, "installAnotherVersion");

            expect(actions.calls).toEqual(["pick:acme.tools", "install:acme.tools@1.0.0"]);
            expect(buttonLabels(pane)[0]).toBe("Reload Window");
            expect(pane.view.querySelector("#extensionPageButton-reload")?.isFocused).toBe(true);
        });

        it("US-1.3: nothing picked — no install, the page stays as it was", async () => {
            const { service } = fakeService([entry()]);
            const actions = fakeActions({ pick: undefined });
            const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
            mount(pane);

            await press(pane, "installAnotherVersion");

            expect(actions.calls).toEqual(["pick:acme.tools"]);
            expect(buttonLabels(pane)).toEqual(["Install", "Install Specific Version..."]);
            expect(enabledFlags(pane)).toEqual([true, true]);
        });

        it("the buttons are not disabled while the picker is open — only during the install itself", () => {
            const { service } = fakeService([entry()]);
            const actions: IExtensionPageActions = {
                ...fakeActions(),
                pickVersion: () => new Promise(() => undefined),
            };
            const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
            mount(pane);

            pressSync(pane, "installAnotherVersion");

            expect(enabledFlags(pane)).toEqual([true, true]);
        });

        it("US-1.13: a failure to read the versions stays on the page as text", async () => {
            const { service } = fakeService([entry()]);
            const actions = fakeActions({ pick: new Error("registry offline") });
            const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
            mount(pane);

            await press(pane, "installAnotherVersion");

            expect(headerLines(pane)).toContain("registry offline");
            expect(actions.calls).toEqual(["pick:acme.tools"]);
        });

        it("US-1.13: a failed install of the picked version stays on the page, nothing to reload", async () => {
            const { service } = fakeService([entry()]);
            const actions = fakeActions({ pick: "1.0.0", install: { ok: false, error: "sha256 mismatch" } });
            const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
            mount(pane);

            await press(pane, "installAnotherVersion");

            expect(headerLines(pane)).toContain("sha256 mismatch");
            expect(buttonLabels(pane)).toEqual(["Install", "Install Specific Version..."]);
        });
    });

    it("the Reload Window button reloads the window", () => {
        const pending = entry({ installedVersion: "1.0.0", availability: "installed", needsReload: true });
        const { service } = fakeService([pending]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, pending, META, null);
        mount(pane);

        pressSync(pane, "reload");

        expect(actions.calls).toEqual(["reload"]);
    });

    describe("Auto Update toggle (ExtensionUpdates stage 3, US-3.8)", () => {
        const installed = entry({ installedVersion: "1.0.0", availability: "installed" });

        it("unchecking pins: the action, no reload, and the focus stays on the toggle as the card follows", async () => {
            const { service, update } = fakeService([installed]);
            const actions = fakeActions();
            const pane = new ExtensionEditorPane(service, actions, installed, META, null);
            mount(pane);
            pane.view.querySelector("#extensionPageButton-toggleAutoUpdate")!.focus();

            await press(pane, "toggleAutoUpdate");
            update([{ ...installed, pinned: true }]);

            expect(actions.calls).toEqual(["autoUpdate:acme.tools:false"]);
            expect(buttonLabels(pane)).toEqual(["Install Specific Version...", "Uninstall", "[ ] Auto Update"]);
            expect(pane.view.querySelector("#extensionPageButton-toggleAutoUpdate")?.isFocused).toBe(true);
        });

        it("checking a pinned one asks to unpin it", async () => {
            const pinned = { ...installed, pinned: true };
            const { service } = fakeService([pinned]);
            const actions = fakeActions();
            const pane = new ExtensionEditorPane(service, actions, pinned, META, null);
            mount(pane);

            await press(pane, "toggleAutoUpdate");

            expect(actions.calls).toEqual(["autoUpdate:acme.tools:true"]);
        });

        it("a failure stays on the page as text", async () => {
            const { service } = fakeService([installed]);
            const actions = fakeActions({ setAutoUpdate: { ok: false, error: "disk full" } });
            const pane = new ExtensionEditorPane(service, actions, installed, META, null);
            mount(pane);

            await press(pane, "toggleAutoUpdate");

            expect(headerLines(pane)).toContain("disk full");
        });

        it("`extensions.autoUpdate` turned off on the fly — the open page disables the toggle", () => {
            const { service } = fakeService([installed]);
            const actions = fakeActions();
            const pane = new ExtensionEditorPane(service, actions, installed, META, null);
            mount(pane);

            actions.setAutoUpdateSetting(false);

            expect(buttonLabels(pane).at(-1)).toBe("[ ] Auto Update (extensions.autoUpdate is off)");
            expect(enabledFlags(pane).at(-1)).toBe(false);
        });

        it("a closed page no longer follows the setting", () => {
            const { service } = fakeService([installed]);
            const actions = fakeActions();
            const pane = new ExtensionEditorPane(service, actions, installed, META, null);
            mount(pane);

            pane.dispose();
            actions.setAutoUpdateSetting(false);

            expect(buttonLabels(pane).at(-1)).toBe("[x] Auto Update");
        });
    });

    it("a vanished card no longer offers uninstall — nothing left to remove", () => {
        const installed = entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" });
        const { service, update } = fakeService([installed]);
        const pane = new ExtensionEditorPane(service, fakeActions(), installed, undefined, null);
        mount(pane);
        expect(buttonLabels(pane)).toEqual(["Uninstall"]);

        update([]);

        expect(buttonLabels(pane)).toEqual([]);
        expect(headerLines(pane)).toContain("Not installed");
    });
});
