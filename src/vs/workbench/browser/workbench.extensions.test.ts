import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { IRegistryExtensionMeta } from "../../platform/extensionManagement/common/registryFormat.ts";
import { REGISTRY_SCHEMA_VERSION } from "../../platform/extensionManagement/common/registryFormat.ts";
import type {
    IExtensionListEntry,
    IExtensionsWorkbenchService,
} from "../contrib/extensions/common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../contrib/extensions/common/extensionsWorkbench.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

/**
 * Setup lives in the test body, not in `beforeEach`: coverage (mutation coverage included)
 * is attributed to the body, and wiring built in a hook would belong to no test.
 */

const SHOW_EXTENSIONS = "workbench.view.extensions";
const SHOW_EXPLORER = "workbench.view.explorer";

const ENTRY: IExtensionListEntry = {
    id: "acme.tools",
    publisher: "acme",
    name: "tools",
    displayName: "Acme Tools",
    description: "Formatting helpers",
    kind: "native",
    support: undefined,
    latestVersion: "1.2.0",
    installedVersion: null,
    availability: "available",
    pinned: false,
    needsReload: false,
};

const META: IRegistryExtensionMeta = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    id: ENTRY.id,
    publisher: ENTRY.publisher,
    name: ENTRY.name,
    displayName: ENTRY.displayName,
    description: ENTRY.description,
    kind: "native",
    support: undefined,
    readme: "Readme from the registry",
    versions: [],
};

function fakeService(): IExtensionsWorkbenchService {
    return {
        ensureLoaded: () => Promise.resolve(),
        refresh: () => Promise.resolve(),
        getEntries: () => [ENTRY],
        getCatalogError: () => null,
        install: () => Promise.resolve({ ok: true as const, version: "1.0.0" }),
        uninstall: () => Promise.resolve({ ok: true as const }),
        getMeta: () => Promise.resolve(META),
        checkForUpdates: () => Promise.resolve(),
        getOutdated: () => [],
        updateAll: () => Promise.resolve({ updated: [], failed: [] }),
        getCompatibleVersions: () => Promise.resolve([]),
        onDidChange: () => ({ dispose: () => {} }),
    };
}

interface IHarness {
    readonly execute: (command: string) => void;
    readonly screen: () => string;
    readonly extensionsList: () => ListViewElement;
    readonly contextKey: (key: "extensionsViewletVisible") => boolean | undefined;
    readonly activeUri: () => string | undefined;
    readonly focusedId: () => string | undefined;
}

describe("Workbench — extension marketplace in the sidebar end-to-end", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    function setup(): IHarness {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-", files: { "a.txt": "alpha\n" } });

        const { container, bindApp } = createTestContainer();
        // Before the component is first resolved: in the test profile the marketplace is an empty null object.
        container.bind(ExtensionsWorkbenchServiceDIToken, fakeService);

        const workbench = container.get(WorkbenchComponentDIToken);
        const commands = container.get(CommandRegistryDIToken);
        const contextKeys = container.get(ContextKeyServiceDIToken);
        const workbenchContextKeys = container.get(WorkbenchContextKeysDIToken);
        const editors = container.get(EditorServiceDIToken);

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        const testApp = TestApp.create(workbench.view, new Size(120, 24));
        bindApp(testApp.app);

        return {
            execute: (command) => {
                commands.execute(command);
                workbenchContextKeys.update();
            },
            screen: () => {
                testApp.render();
                return testApp.backend.screenToString();
            },
            extensionsList: () => {
                const list = workbench.view.querySelector("#extensionsList");
                expect(list, "marketplace list not found in the tree").not.toBeNull();
                return list as ListViewElement;
            },
            contextKey: (key) => contextKeys.get(key),
            activeUri: () => editors.getActivePane()?.uri.toString(),
            focusedId: () => testApp.app.focusManager?.activeElement?.id,
        };
    }

    it("the show command puts the marketplace viewlet in the sidebar", () => {
        const h = setup();
        expect(h.screen()).toContain("EXPLORER");

        h.execute(SHOW_EXTENSIONS);
        const shown = h.screen();
        expect(shown).toContain("EXTENSIONS");
        expect(shown).toContain("Search Extensions");
        expect(shown).toContain("Acme Tools");
        expect(shown).not.toContain("EXPLORER");
    });

    it("switching back to Explorer restores the file tree", () => {
        const h = setup();
        h.execute(SHOW_EXTENSIONS);
        h.execute(SHOW_EXPLORER);

        const shown = h.screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).not.toContain("Search Extensions");
    });

    it("the marketplace visibility context key follows the active viewlet", () => {
        const h = setup();
        h.execute(SHOW_EXTENSIONS);
        expect(h.contextKey("extensionsViewletVisible")).toBe(true);

        h.execute(SHOW_EXPLORER);
        expect(h.contextKey("extensionsViewletVisible")).toBe(false);
    });

    it("Enter on an entry opens the extension page as an editor tab", async () => {
        const h = setup();
        h.execute(SHOW_EXTENSIONS);

        const list = h.extensionsList();
        list.setCursorTo("extensionsGroup-marketplace-acme-tools");
        list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        await settle(0);

        expect(h.activeUri()).toBe("extension:acme.tools");
        const shown = h.screen();
        expect(shown).toContain("Acme Tools");
        expect(shown).toContain("Readme from the registry");
        // The tab is focused before the page's first frame — the button must already exist.
        expect(shown).toContain("[ Install ]");
        expect(h.focusedId()).toBe("extensionPageButton-install");
    });
});
