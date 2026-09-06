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
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../contrib/extensions/common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../contrib/extensions/common/extensionsWorkbench.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

/**
 * Сквозной гейт магазина «до кадра»: команда `workbench.view.extensions`
 * показывает вьюлет EXTENSIONS в сайдбаре (вместо Explorer), Enter на записи
 * открывает страницу расширения вкладкой в области редактора.
 *
 * Юниты компонента проверяют его собственный кадр; здесь проверяется проводка,
 * которой у компонента нет: контейнер вьюлета в сайдбаре, контекст-ключ
 * видимости и шов «страница → полоса редакторов» из DI-модуля. Сборка живёт в
 * теле теста, а не в `beforeEach`: покрытие (в том числе мутационное) считается
 * по телу, и проводка, поднятая в хуке, осталась бы «ничьей».
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

interface IHarness {
    readonly execute: (command: string) => void;
    readonly screen: () => string;
    /** Список вьюлета из живого дерева — компонент напрямую не резолвим. */
    readonly extensionsList: () => ListViewElement;
    readonly contextKey: (key: "extensionsViewletVisible") => boolean | undefined;
    readonly activeUri: () => string | undefined;
}

describe("Workbench — магазин расширений в сайдбаре end-to-end", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
    });

    function setup(): IHarness {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-", files: { "a.txt": "alpha\n" } });

        const { container, bindApp } = createTestContainer();
        // Магазин подменяем до первого резолва компонента: в тестовом профиле
        // он пустой (NULL-сервис), а здесь нужна запись, которую можно открыть.
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
                expect(list, "список магазина не найден в дереве").not.toBeNull();
                return list as ListViewElement;
            },
            contextKey: (key) => contextKeys.get(key),
            activeUri: () => editors.getActivePane()?.uri.toString(),
        };
    }

    it("команда показа выводит вьюлет магазина в сайдбар", () => {
        const h = setup();
        expect(h.screen()).toContain("EXPLORER");

        h.execute(SHOW_EXTENSIONS);
        const shown = h.screen();
        expect(shown).toContain("EXTENSIONS");
        expect(shown).toContain("Search Extensions");
        expect(shown).toContain("Acme Tools");
        expect(shown).not.toContain("EXPLORER");
    });

    it("переключение обратно на Explorer возвращает дерево файлов", () => {
        const h = setup();
        h.execute(SHOW_EXTENSIONS);
        h.execute(SHOW_EXPLORER);

        const shown = h.screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).not.toContain("Search Extensions");
    });

    it("контекст-ключ видимости магазина следует за активным вьюлетом", () => {
        const h = setup();
        h.execute(SHOW_EXTENSIONS);
        expect(h.contextKey("extensionsViewletVisible")).toBe(true);

        h.execute(SHOW_EXPLORER);
        expect(h.contextKey("extensionsViewletVisible")).toBe(false);
    });

    it("Enter на записи открывает страницу расширения вкладкой редактора", async () => {
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
    });
});
