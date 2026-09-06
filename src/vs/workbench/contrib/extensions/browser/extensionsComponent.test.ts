import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import {
    REGISTRY_SCHEMA_VERSION,
    type IRegistryExtensionMeta,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { IExtensionListEntry, IExtensionsWorkbenchService } from "../common/extensionsWorkbench.ts";

import { ExtensionEditorPane } from "./extensionEditorPane.ts";
import { ExtensionsComponent, type IExtensionsEditorTarget } from "./extensionsComponent.ts";

/** Реестр view не участвует в юнит-тестах компонента — контейнер собирает workbench. */
const NULL_VIEWS_SERVICE = { registerView: () => {} } as unknown as ViewsService;

/** Реестр view, запоминающий дескриптор: через него проверяется показ секции. */
function recordingViewsService(): { service: ViewsService; descriptor: () => { focus: () => void; title: string } } {
    let captured: { focus: () => void; title: string } | undefined;
    const service = {
        registerView: (d: { focus: () => void; title: string }) => {
            captured = d;
        },
    } as unknown as ViewsService;
    return {
        service,
        descriptor: () => {
            expect(captured, "view не зарегистрирована").toBeDefined();
            return captured!;
        },
    };
}

function entry(overrides: Partial<IExtensionListEntry> & { id: string }): IExtensionListEntry {
    const [publisher, name] = overrides.id.split(".");
    return {
        publisher: publisher!,
        name: name!,
        displayName: name!,
        description: "",
        kind: "native",
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        ...overrides,
    };
}

/** Сервис-фейк: карточки и ошибка задаются тестом, вызовы записываются. */
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

    public onDidChange(listener: () => void): { dispose: () => void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Смена данных «с той стороны» — как после установки или Refresh. */
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

function make(
    service: IExtensionsWorkbenchService,
    target: IExtensionsEditorTarget = fakeTarget().target,
): ExtensionsComponent {
    return new ExtensionsComponent(service, NULL_VIEWS_SERVICE, target);
}

function render(component: ExtensionsComponent, w = 44, h = 16): MockTerminalBackend {
    return renderElement(component.view, w, h, { themeVars: true });
}

/** Набор в строку поиска — тем же путём, что даёт виджет ввода. */
function typeQuery(component: ExtensionsComponent, text: string): void {
    const input = component.view.querySelectorAll("InputElement")[0] as InputElement;
    input.inputState.value = text;
    input.onChange?.(text);
}

/** Активация строки списка по её id — то же, что Enter/двойной клик. */
function activate(component: ExtensionsComponent, rowId: string): void {
    const row = component.view.querySelector(`#${rowId}`);
    expect(row, `строка #${rowId} не найдена`).not.toBeNull();
    component.list.onActivate?.(row!);
}

describe("ExtensionsComponent", () => {
    it("список и корень несут свои id и цвета сайдбара", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));
        expect(component.view.id).toBe("extensionsView");
        expect(component.list.id).toBe("extensionsList");

        // Фон вьюлета — токен сайдбара, а не унаследованный фон редактора.
        const screen = render(component);
        const sideBar = WorkbenchTheme.fromThemeFile(darkPlusTheme).getRequiredColor("sideBar.background");
        expect(screen.getBgAt(new Point(0, 0))).toBe(sideBar);
    });

    it("строка поиска не прижата к краям панели", () => {
        const component = make(new FakeService([]));
        const line = render(component).screenToString().split("\n")[0]!;
        expect(line.startsWith(" ")).toBe(true);
        expect(line.endsWith(" ")).toBe(true);
    });

    it("буквы в списке — не typeahead: курсор остаётся на месте", () => {
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

    it("записи лежат под своими группами — свёрнутая группа их прячет", () => {
        const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
        const component = make(service);
        expect(render(component).screenToString()).toContain("Acme Tools");

        component.list.setCollapsed("extensionsGroup-marketplace", true);
        expect(render(component).screenToString()).not.toContain("Acme Tools");
    });

    it("установленное вне реестра не попадает в каталог, а реестровое без установки — в INSTALLED", () => {
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

    it("пустое состояние показывается только когда список правда пуст", () => {
        const component = make(new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]));
        expect(render(component).screenToString()).not.toContain("No extensions found");
    });

    it("строки прошлого состава не оставляют за собой действий", async () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools" }),
            entry({ id: "other.thing", displayName: "Other Thing" }),
        ]);
        const { target, opened } = fakeTarget();
        const component = make(service, target);
        const staleRowId = "extensionsGroup-marketplace-acme-tools";

        // Карточка в сервисе осталась, но фильтр её строку убрал — значит и
        // действие по ней обязано исчезнуть вместе со строкой.
        typeQuery(component, "other");
        component.list.onActivate?.({ id: staleRowId } as TUIElement);
        await Promise.resolve();
        await Promise.resolve();
        expect(opened).toHaveLength(0);
    });

    it("показывает строку поиска, каталог и секцию установленных", () => {
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

    it("установленное из магазина видно и в каталоге с бейджем, и в своей секции", () => {
        const service = new FakeService([
            entry({ id: "acme.tools", displayName: "Acme Tools", installedVersion: "1.0.0", availability: "installed" }),
        ]);
        const component = make(service);
        const screen = render(component).screenToString();

        expect(screen.match(/Acme Tools/g)).toHaveLength(2);
        expect(screen).toContain("Installed");
    });

    it("бейджи обновления и несовместимости видны в кадре", () => {
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

    it("фильтрует по мере ввода", () => {
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

    it("ничего не нашлось — так и говорит", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));

        typeQuery(component, "zzz");
        expect(render(component).screenToString()).toContain("No extensions found");
    });

    it("пустой каталог без установленных — тоже пустое состояние", () => {
        expect(render(make(new FakeService([]))).screenToString()).toContain("No extensions found");
    });

    it("ошибка каталога показывается с причиной и предлагает повтор", () => {
        const service = new FakeService([], "getaddrinfo ENOTFOUND example.invalid");
        const screen = render(make(service), 70).screenToString();

        // Заголовок секции остаётся: ошибка — состояние каталога, а не замена ему.
        expect(screen).toContain("MARKETPLACE");
        expect(screen).toContain("Retry");
        expect(screen).toContain("ENOTFOUND");
    });

    it("при ошибке каталога установленные всё равно видны", () => {
        const service = new FakeService(
            [entry({ id: "local.helper", displayName: "Helper", latestVersion: null, installedVersion: "0.1.0", availability: "installed" })],
            "offline",
        );
        const screen = render(make(service)).screenToString();

        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Helper");
    });

    it("строка ошибки живёт под заголовком каталога", () => {
        const component = make(new FakeService([], "offline"));
        expect(render(component, 70).screenToString()).toContain("Retry");

        // Свёрнутый каталог прячет и причину сбоя: строка принадлежит секции.
        component.list.setCollapsed("extensionsGroup-marketplace", true);
        expect(render(component, 70).screenToString()).not.toContain("Retry");
    });

    it("активация строки ошибки перечитывает каталог", () => {
        const service = new FakeService([], "offline");
        const component = make(service);

        activate(component, "extensionsRetry");
        expect(service.refreshCalls).toBe(1);
    });

    it("смена данных сервиса перестраивает список", () => {
        const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
        const component = make(service);

        service.update([entry({ id: "other.thing", displayName: "Other Thing" })]);
        const screen = render(component).screenToString();
        expect(screen).toContain("Other Thing");
        expect(screen).not.toContain("Acme Tools");
    });

    it("фильтр переживает смену данных", () => {
        const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
        const component = make(service);
        typeQuery(component, "acme");

        service.update([entry({ id: "acme.tools", displayName: "Acme Tools" }), entry({ id: "other.thing", displayName: "Other Thing" })]);
        const screen = render(component).screenToString();
        expect(screen).toContain("Acme Tools");
        expect(screen).not.toContain("Other Thing");
    });

    it("пока каталог читается — «Loading», а не «ничего не найдено»", async () => {
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

    it("показ секции ведёт в строку поиска и читает каталог", () => {
        const service = new FakeService([entry({ id: "acme.tools" })]);
        const views = recordingViewsService();
        const component = new ExtensionsComponent(service, views.service, fakeTarget().target);

        // Тот же путь, которым секцию показывает ViewsService (команда, reveal).
        views.descriptor().focus();
        expect(service.ensureLoadedCalls).toBe(1);
        expect(views.descriptor().title).toBe("EXTENSIONS");
    });

    it("focus читает каталог: до показа вьюлета в сеть не ходим", () => {
        const service = new FakeService([entry({ id: "acme.tools" })]);
        const component = make(service);
        expect(service.ensureLoadedCalls).toBe(0);

        component.focus();
        expect(service.ensureLoadedCalls).toBe(1);
    });

    it("focus ставит курсор в строку поиска", () => {
        const component = make(new FakeService([entry({ id: "acme.tools" })]));
        TestApp.createWithContent(component.view).render();

        component.focus();
        expect((component.view.querySelectorAll("InputElement")[0] as InputElement).isFocused).toBe(true);
    });

    it("refresh компонента делегирует сервису", async () => {
        const service = new FakeService([]);
        await make(service).refresh();
        expect(service.refreshCalls).toBe(1);
    });

    describe("открытие страницы", () => {
        const meta: IRegistryExtensionMeta = {
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            id: "acme.tools",
            publisher: "acme",
            name: "tools",
            displayName: "Acme Tools",
            description: "",
            kind: "native",
            readme: "Readme body",
            versions: [],
        };

        it("Enter на записи открывает вкладку расширения", async () => {
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

        it("страница несёт readme из меты", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })], null, {
                "acme.tools": meta,
            });
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            await component.openExtensionPage("acme.tools");
            expect(renderElement(opened[0]!.view, 40, 20, { themeVars: true }).screenToString()).toContain("Readme body");
        });

        it("сбой чтения меты не оставляет пустую вкладку — причина на странице", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            service.metaError = new Error("fetch failed (ENOTFOUND)");
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            await component.openExtensionPage("acme.tools");
            expect(renderElement(opened[0]!.view, 70, 20, { themeVars: true }).screenToString()).toContain("ENOTFOUND");
        });

        it("запись из секции установленных открывает ту же вкладку", async () => {
            const service = new FakeService([
                entry({ id: "acme.tools", displayName: "Acme Tools", installedVersion: "1.0.0", availability: "installed" }),
            ]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            activate(component, "extensionsGroup-installed-acme-tools");
            await Promise.resolve();
            await Promise.resolve();
            expect(opened[0]?.uri.toString()).toBe("extension:acme.tools");
        });

        it("Enter на заголовке группы ничего не открывает", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            activate(component, "extensionsGroup-marketplace");
            await Promise.resolve();
            expect(opened).toHaveLength(0);
        });

        it("не-Error отказ реестра тоже доезжает текстом", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            service.getMeta = () => Promise.reject("registry said no");
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            await component.openExtensionPage("acme.tools");
            expect(renderElement(opened[0]!.view, 70, 20, { themeVars: true }).screenToString()).toContain(
                "registry said no",
            );
        });

        it("чужой id вкладку не открывает, даже когда карточки есть", async () => {
            const service = new FakeService([entry({ id: "acme.tools", displayName: "Acme Tools" })]);
            const { target, opened } = fakeTarget();
            const component = make(service, target);

            // Промах по id обязан быть промахом, а не «первой попавшейся записью».
            await component.openExtensionPage("acme.gone");
            expect(opened).toHaveLength(0);
        });
    });
});
