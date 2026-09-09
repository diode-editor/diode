import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane, extensionUri } from "./extensionEditorPane.ts";
import type { IExtensionPageActions } from "./extensionPageActions.ts";
import type { IExtensionInstallResult, IExtensionOperationResult } from "../common/extensionsWorkbench.ts";

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
        needsReload: false,
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
    readme: "Readme body",
    versions: [],
};

/** Действия-фейк: записывают вызовы и отдают заранее заданный исход. */
function fakeActions(
    results: { install?: IExtensionInstallResult; uninstall?: IExtensionOperationResult } = {},
): IExtensionPageActions & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        install: (id) => {
            calls.push(`install:${id}`);
            return Promise.resolve(results.install ?? { ok: true, version: "1.0.0" });
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

/** Поднимает страницу в приложении: фокус и события живут в дереве приложения. */
function mount(pane: ExtensionEditorPane): void {
    TestApp.createWithContent(pane.view).render();
}

/** Нажимает кнопку шапки (Enter — как с клавиатуры) и ждёт завершения операции. */
function press(pane: ExtensionEditorPane, kind: string): Promise<void> {
    pressSync(pane, kind);
    // Операция асинхронная: даём промису установки/удаления дойти до конца.
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function pressSync(pane: ExtensionEditorPane, kind: string): void {
    const button = pane.view.querySelector(`#extensionPageButton-${kind}`)!;
    button.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
}

/** Подписи кнопок шапки — их же читает пользователь. */
function buttonLabels(pane: ExtensionEditorPane): string[] {
    const buttons = headerState(pane)["buttons"] as { label: string }[];
    return buttons.map((b) => b.label);
}

function enabledFlags(pane: ExtensionEditorPane): boolean[] {
    const buttons = headerState(pane)["buttons"] as { enabled: boolean }[];
    return buttons.map((b) => b.enabled);
}

function headerLines(pane: ExtensionEditorPane): string[] {
    return headerState(pane)["lines"] as string[];
}

function headerState(pane: ExtensionEditorPane): Record<string, unknown> {
    return pane.view.querySelector("#extensionPageHeader")!.inspectState()!;
}

function screenOf(pane: ExtensionEditorPane, w = 50, h = 20): string {
    return renderElement(pane.view, w, h, { themeVars: true }).screenToString();
}

describe("ExtensionEditorPane", () => {
    it("ресурс вкладки — id расширения под схемой extension", () => {
        expect(extensionUri("acme.tools").toString()).toBe("extension:acme.tools");
    });

    it("метка вкладки — displayName, правки запрещены", () => {
        const { service } = fakeService([entry()]);
        const pane: IEditorPane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);

        expect(pane.label).toBe("Acme Tools");
        expect(pane.readOnly).toBe(true);
        expect(pane.isModified).toBe(false);
        // Текстовой проекции у страницы нет — команды курсора её не видят.
        expect(pane.viewState).toBeUndefined();
        expect(pane.getSelectedTexts()).toEqual([]);
    });

    it("панель несёт id и цвета редактора — вкладку видно инспектору", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        renderElement(pane.view, 50, 20, { themeVars: true });

        // Точки в id селектор инспектора не понимает — они заменены дефисами.
        expect(pane.view.id).toBe("extensionPage-acme-tools");
        expect(pane.view.style).toMatchObject({ fg: "editor.foreground", bg: "editor.background" });
    });

    it("страница показывает шапку и readme", () => {
        const { service } = fakeService([entry()]);
        const screen = screenOf(new ExtensionEditorPane(service, fakeActions(), entry(), META, null));

        expect(screen).toContain("Acme Tools");
        expect(screen).toContain("acme.tools");
        expect(screen).toContain("Not installed");
        expect(screen).toContain("Readme body");
    });

    it("мета и причина её отсутствия переживают обновление карточки", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), undefined, "boom");

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);
        const screen = screenOf(pane, 70);
        expect(screen).toContain("Installed 1.0.0");
        // Причина сбоя не теряется при перерисовке — иначе страница молча пустеет.
        expect(screen).toContain("boom");
    });

    it("смена состояния расширения доезжает до открытой страницы", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        expect(screenOf(pane)).toContain("Not installed");

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);
        expect(screenOf(pane)).toContain("Installed 1.0.0");
    });

    it("страница следит за своей карточкой, а не за первой в списке", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);

        update([
            entry({ id: "other.thing", displayName: "Other", installedVersion: "9.9.9", availability: "installed" }),
            entry(),
        ]);
        // Обновилась чужая карточка — статус нашей остаётся прежним.
        expect(screenOf(pane)).toContain("Not installed");
    });

    it("исчезнувшая карточка страницу не ломает — остаётся последнее известное", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);

        update([]);
        expect(screenOf(pane)).toContain("Acme Tools");
    });

    it("смена displayName перерисовывает вкладку", () => {
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

    it("прежнее имя вкладки лишних перерисовок не вызывает", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        });

        update([entry({ availability: "installed", installedVersion: "1.0.0" })]);
        expect(stateChanges).toBe(0);
    });

    it("подписка на смену метки снимается своим dispose", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        let stateChanges = 0;
        pane.onDidChangeState(() => {
            stateChanges++;
        }).dispose();

        update([entry({ displayName: "Renamed" })]);
        expect(stateChanges).toBe(0);
    });

    it("после dispose панель на события сервиса не реагирует", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        pane.dispose();

        update([entry({ displayName: "Renamed" })]);
        expect(pane.label).toBe("Acme Tools");
    });

    it("страница отдаёт свои строки инспектору — по ним ассертят e2e", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        renderElement(pane.view, 50, 20, { themeVars: true });

        // Шапка и тело — разные элементы: у каждого свой снимок строк.
        const header = pane.view.querySelector("#extensionPageHeader")!;
        expect((header.inspectState()!["lines"] as string[]).slice(0, 2)).toEqual(["Acme Tools", "acme.tools"]);
        expect(pane.view.inspectState()?.["lines"] as string[]).toContain("Readme body");
    });

    it("focusEditor отдаёт фокус первому действию — с него начинают на этой странице", () => {
        const { service } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        const app = TestApp.createWithContent(pane.view);
        app.render();

        pane.focusEditor();
        expect(pane.view.querySelector("#extensionPageButton-install")?.isFocused).toBe(true);
    });

    it("Install ставит расширение и зовёт перезагрузить окно", async () => {
        const { service } = fakeService([entry()]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
        mount(pane);

        await press(pane, "install");

        expect(actions.calls).toEqual(["install:acme.tools"]);
        // Кнопка установки сменилась приглашением перезагрузиться, и фокус — на нём:
        // это следующий шаг, а не поиск команды в палитре.
        expect(buttonLabels(pane)).toEqual(["Reload Window", "Install"]);
        expect(pane.view.querySelector("#extensionPageButton-reload")?.isFocused).toBe(true);
    });

    it("Update — та же установка: отдельной операции обновления нет", async () => {
        const outdated = entry({ installedVersion: "0.9.0", availability: "outdated" });
        const { service } = fakeService([outdated]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, outdated, META, null);
        mount(pane);

        await press(pane, "update");

        expect(actions.calls).toEqual(["install:acme.tools"]);
    });

    it("Uninstall удаляет и тоже просит перезагрузку", async () => {
        const installed = entry({ installedVersion: "1.0.0", availability: "installed" });
        const { service } = fakeService([installed]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, installed, META, null);
        mount(pane);

        await press(pane, "uninstall");

        expect(actions.calls).toEqual(["uninstall:acme.tools"]);
        expect(buttonLabels(pane)).toContain("Reload Window");
    });

    it("ошибка установки остаётся на странице, а кнопка снова доступна", async () => {
        const { service } = fakeService([entry()]);
        const actions = fakeActions({ install: { ok: false, error: "sha256 mismatch" } });
        const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
        mount(pane);

        await press(pane, "install");

        expect(headerLines(pane)).toContain("sha256 mismatch");
        // Перезагружаться незачем — ничего не изменилось; повторить можно тут же.
        expect(buttonLabels(pane)).toEqual(["Install"]);
        expect(enabledFlags(pane)).toEqual([true]);
    });

    it("на время операции кнопки погашены — второй установки не запустить", async () => {
        const { service } = fakeService([entry()]);
        let finish = (): void => {};
        const actions: IExtensionPageActions & { calls: string[] } = {
            ...fakeActions(),
            install: () =>
                new Promise((resolve) => {
                    finish = () => resolve({ ok: true, version: "1.0.0" });
                }),
        };
        const pane = new ExtensionEditorPane(service, actions, entry(), META, null);
        mount(pane);

        const running = press(pane, "install");
        expect(enabledFlags(pane)).toEqual([false]);

        finish();
        await running;
        expect(enabledFlags(pane)).toEqual([true, true]);
    });

    it("ожидание перезагрузки приезжает и из карточки — ставили из другого места", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        mount(pane);

        update([entry({ installedVersion: "1.0.0", availability: "installed", needsReload: true })]);

        expect(buttonLabels(pane)).toEqual(["Reload Window", "Uninstall"]);
    });

    it("чужое обновление карточки не выдумывает ожидание перезагрузки", () => {
        const { service, update } = fakeService([entry()]);
        const pane = new ExtensionEditorPane(service, fakeActions(), entry(), META, null);
        mount(pane);

        update([entry({ installedVersion: "1.0.0", availability: "installed" })]);

        // Ставили не мы и не в этой сессии — перезагружаться незачем.
        expect(buttonLabels(pane)).toEqual(["Uninstall"]);
    });

    it("кнопка Reload Window зовёт перезагрузку окна", () => {
        const pending = entry({ installedVersion: "1.0.0", availability: "installed", needsReload: true });
        const { service } = fakeService([pending]);
        const actions = fakeActions();
        const pane = new ExtensionEditorPane(service, actions, pending, META, null);
        mount(pane);

        pressSync(pane, "reload");

        expect(actions.calls).toEqual(["reload"]);
    });

    it("исчезнувшая карточка больше не предлагает удаление — удалять уже нечего", () => {
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
