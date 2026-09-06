import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import { settle } from "../../../TestUtils/timing.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import type { IRegistryExtensionMeta } from "../../platform/extensionManagement/common/registryFormat.ts";
import { REGISTRY_SCHEMA_VERSION } from "../../platform/extensionManagement/common/registryFormat.ts";
import { ExtensionsComponentDIToken } from "../contrib/extensions/browser/extensionsComponent.ts";
import type { ExtensionsComponent } from "../contrib/extensions/browser/extensionsComponent.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../contrib/extensions/common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../contrib/extensions/common/extensionsWorkbench.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";
import type { WorkbenchComponent } from "./workbenchComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";
import type { WorkbenchContextKeys } from "./workbenchContextKeys.ts";

/**
 * Сквозной гейт магазина «до кадра»: команда `workbench.view.extensions`
 * показывает вьюлет EXTENSIONS в сайдбаре (вместо Explorer), Enter на записи
 * открывает страницу расширения вкладкой в области редактора.
 *
 * Юниты компонента проверяют его собственный кадр; здесь проверяется проводка,
 * которой у компонента нет: контейнер вьюлета в сайдбаре, контекст-ключ
 * видимости и шов «страница → полоса редакторов» из DI-модуля.
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
    latestVersion: "1.2.0",
    installedVersion: null,
    availability: "available",
};

const META: IRegistryExtensionMeta = {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    id: ENTRY.id,
    publisher: ENTRY.publisher,
    name: ENTRY.name,
    displayName: ENTRY.displayName,
    description: ENTRY.description,
    kind: "native",
    readme: "Readme from the registry",
    versions: [],
};

/** Магазин с одной записью — сеть и диск в этом тесте не участвуют. */
function fakeService(): IExtensionsWorkbenchService {
    return {
        ensureLoaded: () => Promise.resolve(),
        refresh: () => Promise.resolve(),
        getEntries: () => [ENTRY],
        getCatalogError: () => null,
        getMeta: () => Promise.resolve(META),
        onDidChange: () => ({ dispose: () => {} }),
    };
}

describe("Workbench — магазин расширений в сайдбаре end-to-end", () => {
    let ws: ITempWorkspace;
    let workbench: WorkbenchComponent;
    let commands: CommandRegistry;
    let contextKeys: ContextKeyService;
    let workbenchContextKeys: WorkbenchContextKeys;
    let extensions: ExtensionsComponent;
    let editors: EditorService;
    let testApp: TestApp;

    function screen(): string {
        testApp.render();
        return testApp.backend.screenToString();
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-", files: { "a.txt": "alpha\n" } });

        const { container, bindApp } = createTestContainer();
        // Магазин подменяем до первого резолва компонента: в тестовом профиле
        // он пустой (NULL-сервис), а здесь нужна запись, которую можно открыть.
        container.bind(ExtensionsWorkbenchServiceDIToken, fakeService);

        workbench = container.get(WorkbenchComponentDIToken);
        commands = container.get(CommandRegistryDIToken);
        contextKeys = container.get(ContextKeyServiceDIToken);
        workbenchContextKeys = container.get(WorkbenchContextKeysDIToken);
        extensions = container.get(ExtensionsComponentDIToken);
        editors = container.get(EditorServiceDIToken);

        workbench.setWorkspaceFolder(ws.dir);
        workbench.mount();
        testApp = TestApp.create(workbench.view, new Size(120, 24));
        bindApp(testApp.app);
    });

    afterEach(() => {
        ws.dispose();
    });

    it("команда показа выводит вьюлет магазина в сайдбар", () => {
        expect(screen()).toContain("EXPLORER");

        commands.execute(SHOW_EXTENSIONS);
        const shown = screen();
        expect(shown).toContain("EXTENSIONS");
        expect(shown).toContain("Search Extensions");
        expect(shown).toContain("Acme Tools");
        expect(shown).not.toContain("EXPLORER");
    });

    it("переключение обратно на Explorer возвращает дерево файлов", () => {
        commands.execute(SHOW_EXTENSIONS);
        commands.execute(SHOW_EXPLORER);

        const shown = screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).not.toContain("Search Extensions");
    });

    it("контекст-ключ видимости магазина следует за активным вьюлетом", () => {
        commands.execute(SHOW_EXTENSIONS);
        workbenchContextKeys.update();
        expect(contextKeys.get("extensionsViewletVisible")).toBe(true);

        commands.execute(SHOW_EXPLORER);
        workbenchContextKeys.update();
        expect(contextKeys.get("extensionsViewletVisible")).toBe(false);
    });

    it("Enter на записи открывает страницу расширения вкладкой редактора", async () => {
        commands.execute(SHOW_EXTENSIONS);
        extensions.list.setCursorTo("extensionsGroup-marketplace-acme-tools");
        extensions.list.dispatchEvent(new TUIKeyboardEvent("keypress", { key: "Enter" }));
        await settle(0);

        expect(editors.getActivePane()?.uri.toString()).toBe("extension:acme.tools");
        const shown = screen();
        expect(shown).toContain("Acme Tools");
        expect(shown).toContain("Readme from the registry");
    });
});
