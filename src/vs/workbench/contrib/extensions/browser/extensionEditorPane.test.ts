import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane, extensionUri } from "./extensionEditorPane.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        ...overrides,
    };
}

/** Сервис-фейк: важны только карточки и событие их смены. */
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
    readme: "Readme body",
    versions: [],
};

function screenOf(pane: ExtensionEditorPane, w = 50, h = 20): string {
    return renderElement(pane.view, w, h, { themeVars: true }).screenToString();
}

describe("ExtensionEditorPane", () => {
    it("ресурс вкладки — id расширения под схемой extension", () => {
        expect(extensionUri("acme.tools").toString()).toBe("extension:acme.tools");
    });

    it("метка вкладки — displayName, правки запрещены", () => {
        const { service } = fakeService([entry()]);
        const pane: IEditorPane = new ExtensionEditorPane(service, entry(), META, null);

        expect(pane.label).toBe("Acme Tools");
        expect(pane.readOnly).toBe(true);
        expect(pane.isModified).toBe(false);
        // Текстовой проекции у страницы нет — команды курсора её не видят.
        expect(pane.viewState).toBeUndefined();
        expect(pane.getSelectedTexts()).toEqual([]);
    });

    it("страница показывает шапку и readme", () => {
        const { service } = fakeService([entry()]);
        const screen = screenOf(new ExtensionEditorPane(service, entry(), META, null));

        expect(screen).toContain("Acme Tools");
        expect(screen).toContain("acme.tools");
        expect(screen).toContain("Not installed");
        expect(screen).toContain("Readme body");
    });

    it("смена состояния расширения доезжает до открытой страницы", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        expect(screenOf(pane)).toContain("Not installed");

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);
        expect(screenOf(pane)).toContain("Installed 1.0.0");
    });

    it("исчезнувшая карточка страницу не ломает — остаётся последнее известное", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);

        update([]);
        expect(screenOf(pane)).toContain("Acme Tools");
    });

    it("смена displayName перерисовывает вкладку", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        });

        update([entry({ displayName: "Renamed" })]);
        expect(pane.label).toBe("Renamed");
        expect(stateChanges).toBe(1);
    });

    it("прежнее имя вкладки лишних перерисовок не вызывает", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        });

        update([entry({ availability: "installed", installedVersion: "1.0.0" })]);
        expect(stateChanges).toBe(0);
    });

    it("подписка на смену метки снимается своим dispose", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        }).dispose();

        update([entry({ displayName: "Renamed" })]);
        expect(stateChanges).toBe(0);
    });

    it("после dispose панель на события сервиса не реагирует", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        pane.dispose();

        update([entry({ displayName: "Renamed" })]);
        expect(pane.label).toBe("Acme Tools");
    });

    it("страница отдаёт свои строки инспектору — по ним ассертят e2e", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        renderElement(pane.view, 50, 20, { themeVars: true });

        const lines = pane.view.inspectState()?.["lines"] as string[];
        expect(lines.slice(0, 2)).toEqual(["Acme Tools", "acme.tools"]);
        expect(lines).toContain("Readme body");
    });

    it("focusEditor отдаёт фокус списку строк — так работают PageUp/PageDown", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, entry(), META, null);
        const app = TestApp.createWithContent(pane.view);
        app.render();

        pane.focusEditor();
        expect(pane.view.querySelector("#extensionPageLines")?.isFocused).toBe(true);
    });
});
