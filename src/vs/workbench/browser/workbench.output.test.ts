import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import type { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../base/common/uri.ts";
import { createSelection } from "../../editor/common/core/iSelection.ts";
import { CHECKED_ICON } from "../../platform/actions/common/menuRegistry.ts";
import { MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogService } from "../../platform/log/common/logService.ts";
import { RingBufferSink } from "../../platform/log/common/ringBufferSink.ts";
import { loadState, StateService } from "../../platform/state/node/stateService.ts";
import { EditorOptionsServiceAdapter } from "../api/browser/editorOptionsServiceAdapter.ts";
import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { PROBLEMS_VIEW_ID } from "../contrib/markers/browser/problemsComponent.ts";
import { SwitchOutputMenu } from "../contrib/output/browser/outputChannelActions.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";
import { LogHistoryDIToken, OUTPUT_VIEW_ID, OutputChannelRegistryDIToken } from "../services/output/common/output.ts";
import { OutputChannelRegistry } from "../services/output/common/outputChannelRegistry.ts";
import { OutputServiceDIToken } from "../services/output/common/outputService.ts";

import type { TextEditorPane } from "./parts/editor/textEditorPane.ts";
import { PanelServiceDIToken } from "./parts/panel/panelService.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchStateServiceDIToken } from "./workbenchStateService.ts";

const TOGGLE_OUTPUT = "workbench.action.output.toggleOutput";

/**
 * Output-панель целиком: от записи в лог до кадра. Тесты сервиса
 * (`outputService.test.ts`) по устройству не видят ни вкладки, ни редактора —
 * здесь проверяется именно то, что между ними.
 */
describe("Workbench — Output panel", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let logService: LogService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-output-", files: { "alpha.txt": "Alpha" } });
        // Настоящие LogService + RingBufferSink вместо null-сервиса профиля тестов:
        // связка «лог → буфер → панель» и есть предмет проверки.
        logService = new LogService();
        const history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap").info("diode starting");
        logService.createLogger("configuration").warn("settings.json is empty");

        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
                container.bind(LogHistoryDIToken, () => history);
            },
        });
        h.workbench.openFile(ws.path("alpha.txt"));
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function frame(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    function outputService() {
        return h.container.get(OutputServiceDIToken);
    }

    it("регистрирует вкладку OUTPUT между PROBLEMS и TERMINAL", () => {
        const panel = h.workbench.workbenchLayout.getBottomPanel();
        expect(panel).not.toBeNull();
        h.commands.execute(TOGGLE_OUTPUT);
        expect(frame()).toContain("OUTPUT");
    });

    it("показывает записи активного канала в кадре", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        expect(frame()).toContain("diode starting");
    });

    it("смена канала перерисовывает содержимое", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        expect(frame()).toContain("diode starting");

        outputService().showChannel("configuration");

        const text = frame();
        expect(text).toContain("settings.json is empty");
        expect(text).not.toContain("diode starting");
    });

    it("живой хвост дописывает строку без переоткрытия вкладки", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        logService.createLogger("bootstrap").info("extension host started");

        expect(frame()).toContain("extension host started");
    });

    it("запись в неактивный канал в кадр не попадает", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        logService.createLogger("configuration").info("not shown");

        expect(frame()).not.toContain("not shown");
    });

    it("уровень записи оформлен скобками — под грамматику log", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        expect(frame()).toContain("[info] diode starting");
    });

    it("записи до открытия вкладки не теряются — при открытии они уже в кадре", () => {
        // Редактор поднимается лениво, поэтому хвост, прилетевший раньше, обязан
        // приехать из истории, а не потеряться между сервисом и редактором.
        logService.createLogger("bootstrap").info("before opening");

        h.commands.execute(TOGGLE_OUTPUT);

        expect(frame()).toContain("before opening");
    });

    it("повторное открытие вкладки не задваивает содержимое", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        h.commands.execute(TOGGLE_OUTPUT);
        h.commands.execute(TOGGLE_OUTPUT);

        const occurrences = frame().split("diode starting").length - 1;
        expect(occurrences).toBe(1);
    });

    it("клик по вкладке OUTPUT наполняет её, а не только команда", () => {
        // Пользовательский путь идёт через `activateView` (клик по табу), а
        // toggle-команда — через `setActiveView`, и события активации не шлёт.
        // Без подписки на activateView клик по табу давал бы пустую вкладку.
        const panelService = h.container.get(PanelServiceDIToken);
        h.commands.execute("workbench.action.togglePanel");

        panelService.activateView(OUTPUT_VIEW_ID);

        expect(frame()).toContain("diode starting");
    });

    it("reveal контейнера панели наполняет вкладку (шов focus дескриптора)", () => {
        // Тот же шов, что у Explorer/Search: место просит контейнер отдать фокус,
        // контейнер зовёт focus своей единственной секции — та поднимает редактор
        // канала и подменяет тело view (до этого секция рисует подсказку).
        const outputTab = (): TUIElement =>
            h.container.get(PanelServiceDIToken).getViews().find((v) => v.id === OUTPUT_VIEW_ID)!.content!;
        const placeholder = "#viewPlaceholder-workbench-panel-output";
        expect(outputTab().querySelector(placeholder)).not.toBeNull();

        h.container.get(ViewsServiceDIToken).focusContainer(OUTPUT_VIEW_ID);

        expect(outputTab().querySelector(placeholder)).toBeNull();
    });

    it("активация соседней вкладки панели Output не трогает", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        const panelService = h.container.get(PanelServiceDIToken);

        panelService.activateView(PROBLEMS_VIEW_ID);

        expect(outputService().getActiveChannelId()).toBe("bootstrap");
    });
});

describe("Workbench — Output: селектор канала", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-output-sel-", files: { "alpha.txt": "Alpha" } });
        const logService = new LogService();
        const history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap").info("diode starting");
        logService.createLogger("configuration").warn("empty settings");
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
                container.bind(LogHistoryDIToken, () => history);
            },
        });
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute(TOGGLE_OUTPUT);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function frame(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    it("подпись селектора — label активного канала, а не сырой id", () => {
        // Ради этого и заведён реестр: `bootstrap` пользователю не показываем.
        expect(frame()).toContain("Bootstrap");
        expect(frame()).not.toContain("PROBLEMS  OUTPUT  TERMINAL   bootstrap");
    });

    it("подпись идёт за сменой канала", () => {
        h.container.get(OutputServiceDIToken).showChannel("configuration");

        const text = frame();
        expect(text).toContain("Configuration");
        expect(text).toContain("empty settings");
    });

    it("канал зарегистрирован как команда — её видно и в палитре", () => {
        // Пункты селектора — это команды `workbench.action.output.show.<id>`,
        // как в VS Code; поэтому канал доступен и с клавиатуры.
        const titles = h.commands.listCommands().map((c) => c.title);
        expect(titles).toContain("Output: Show Extension Host");
    });

    it("команда канала переключает активный канал", () => {
        h.commands.execute("workbench.action.output.show.configuration");

        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBe("configuration");
        expect(frame()).toContain("Configuration");
    });

    it("активный канал помечен в submenu — на нём держится подпись селектора", () => {
        // `toggled: activeOutputChannel == '<id>'` — тот же механизм, что в VS Code.
        const menu = h.container.get(MenuServiceDIToken).createMenu(SwitchOutputMenu);
        const marked = () =>
            menu
                .getEntries()
                .filter((e) => e.type !== "separator" && e.icon === CHECKED_ICON)
                .map((e) => (e.type === "separator" ? "" : e.label));

        expect(marked()).toEqual(["Bootstrap"]);

        h.commands.execute("workbench.action.output.show.configuration");

        expect(marked()).toEqual(["Configuration"]);
        menu.dispose();
    });

    it("выбор в селекторе переключает канал — через ту же команду", () => {
        // Полный пользовательский путь: раскрыть список в шапке, выбрать пункт.
        // Он исполняет `workbench.action.output.show.<id>`, а не дёргает сервис
        // напрямую — иначе у выбора мышью и палитры были бы разные маршруты.
        const selector = h.testApp.querySelector("SelectBoxElement") as SelectBoxElement | null;
        expect(selector).not.toBeNull();
        selector!.focus();

        h.testApp.sendKey("Enter");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");

        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBe("configuration");
        expect(frame()).toContain("empty settings");
    });

    it("канал, появившийся в рантайме, доезжает до селектора", () => {
        const logService = h.container.get(ILogServiceDIToken);
        logService.createLogger("brand.new").info("hi");

        const menu = h.container.get(MenuServiceDIToken).createMenu(SwitchOutputMenu);
        const labels = menu.getEntries().map((e) => (e.type === "separator" ? "" : e.label));
        expect(labels).toContain("brand.new");
        menu.dispose();
    });

    it("повторное появление канала не двоит пункт селектора", () => {
        // Канал приходит и из реестра, и из живого потока — регистрация обязана
        // быть идемпотентной, иначе список пух бы на каждую запись.
        const logService = h.container.get(ILogServiceDIToken);
        logService.createLogger("brand.new").info("one");
        logService.createLogger("brand.new").info("two");

        const menu = h.container.get(MenuServiceDIToken).createMenu(SwitchOutputMenu);
        const labels = menu.getEntries().map((e) => (e.type === "separator" ? "" : e.label));
        expect(labels.filter((l) => l === "brand.new")).toHaveLength(1);
        menu.dispose();
    });
});

/**
 * Регрессии из чёрноящичного прогона PR #197. Каждый кейс — воспроизведение
 * репорта, а не пересказ реализации.
 */
describe("Workbench — Output: регрессии", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let h: IAppHarness;
    let logService: LogService;
    let history: RingBufferSink;

    function newState(): StateService {
        return loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
    }

    function boot(stateService: StateService): IAppHarness {
        const harness = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            stateService,
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
                container.bind(LogHistoryDIToken, () => history);
            },
        });
        harness.workbench.openFile(ws.path("alpha.txt"));
        return harness;
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-output-reg-", files: { "alpha.txt": "Alpha" } });
        userData = createTempWorkspace({ prefix: "diode-output-reg-ud-" });
        logService = new LogService();
        history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap").info("diode starting");
        logService.createLogger("configuration").warn("empty settings");
        h = boot(newState());
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        userData.dispose();
    });

    /** Открывает Output и возвращает его detached-редактор. */
    function outputPane(): TextEditorPane {
        h.commands.execute(TOGGLE_OUTPUT);
        const pane = h.container.get(EditorServiceDIToken).getActiveEditor();
        expect(pane?.uri.scheme).toBe("output");
        return pane!;
    }

    it("BUG-1: смена канала не теряет фокус", () => {
        // `replaceOwnedContent` пересобирает `EditorElement`; старый уходил с
        // дерева вместе с фокусом, и клавиатура переставала доходить куда-либо.
        outputPane();

        h.container.get(OutputServiceDIToken).showChannel("configuration");

        // Ассерт на ЖИВОЙ виджет, а не на путь предков: снятый с дерева редактор
        // ссылки на родителя сохраняет, и проверка «фокус где-то под панелью»
        // проходила бы и со сломанным фокусом.
        const pane = h.container.get(EditorServiceDIToken).getActiveEditor();
        expect(pane?.uri.scheme).toBe("output");
        expect(h.testApp.focusedElement).toBe(pane!.view.getChild());

        // И следствие, которое видит пользователь: клавиатура доходит до панели.
        const before = pane!.viewState.selections[0].active.line;
        h.testApp.sendKey("ArrowUp");
        expect(pane!.viewState.selections[0].active.line).not.toBe(before);
    });

    it("BUG-2: read-only с панели Output снять нельзя", () => {
        const pane = outputPane();
        const before = pane.getText();

        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");
        h.testApp.sendKey("X");

        expect(pane.readOnly).toBe(true);
        expect(pane.getText()).toBe(before);
    });

    it("BUG-2: у обычной вкладки read-only по-прежнему переключается", () => {
        // Контроль: гард не должен зарубить команду там, где она и нужна.
        h.workbench.focusEditor();

        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");

        expect(h.container.get(EditorServiceDIToken).getEditors()[0].readOnly).toBe(true);
    });

    it("BUG-2: расширение видит вкладку, а не панель Output", () => {
        outputPane();

        const adapter = new EditorOptionsServiceAdapter(h.container.get(EditorServiceDIToken));

        expect(adapter.getActiveEditorMeta().uri).toBe(Uri.file(ws.path("alpha.txt")).toString());
    });

    it("BUG-3: живой хвост не схлопывает выделение", () => {
        const pane = outputPane();
        pane.viewState.selections = [createSelection(0, 0, 0, 5)];
        const selected = pane.viewState.getSelectedText();
        expect(selected).toHaveLength(5);

        logService.createLogger("bootstrap").info("tail arrives");

        expect(pane.viewState.getSelectedText()).toBe(selected);
    });

    it("BUG-3: хвост не утаскивает вьюпорт, пока читают старые строки", () => {
        const pane = outputPane();
        for (let i = 0; i < 50; i++) logService.createLogger("bootstrap").info(`line ${String(i)}`);
        pane.goToPosition(0, 0);

        logService.createLogger("bootstrap").info("newest");

        expect(pane.viewState.selections[0].active.line).toBe(0);
    });

    it("BUG-3: у конца документа автоскролл продолжает работать", () => {
        // Контроль: гард не должен убить сам автоскролл.
        const pane = outputPane();
        const before = pane.viewState.selections[0].active.line;

        logService.createLogger("bootstrap").info("newest");

        expect(pane.viewState.selections[0].active.line).toBeGreaterThan(before);
    });

    it("BUG-4: Ctrl+F при фокусе в Output ищет по логу, а не по файлу за панелью", () => {
        // `diode starting` есть только в логе, `Alpha` — только в файле.
        outputPane();
        const find = h.container.get(FindComponentDIToken);
        const groupId = h.container.get(EditorServiceDIToken).activeGroup.id;

        h.commands.execute("actions.find");
        const widget = find.widgetFor(groupId)!;
        widget.setQuery("diode starting");
        widget.onQueryChange?.("diode starting");

        // Смотрим на кадр, как и репортёр: счётчик виджета — наблюдаемый результат.
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).not.toContain("No results");
    });

    it("BUG-6: после восстановления сессии вкладка сразу наполнена", () => {
        // Панель осталась открытой на OUTPUT — на следующем запуске события
        // активации уже не будет, и контент обязан подтянуться сам.
        const state1 = newState();
        const first = boot(state1);
        first.commands.execute(TOGGLE_OUTPUT);
        state1.flushSync();
        first.dispose();

        const second = boot(newState());

        second.testApp.render();
        const text = second.testApp.backend.screenToString();
        expect(text).toContain("diode starting");
        expect(text).not.toContain("No output yet.");
        second.dispose();
    });
});

/**
 * Focus-aware `getActiveEditor()` отдаёт detached-панель всем подряд, и
 * потребители с «вкладочной» семантикой ломаются об это по-разному. Класс багов
 * общий, поэтому и тесты рядом.
 */
describe("Workbench — Output: потребители, которым нужна вкладка", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let logService: LogService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-output-tab-",
            files: { "alpha.txt": "AAAA\nBBBB\nCCCC" },
        });
        logService = new LogService();
        const history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap").info("seed");
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
                container.bind(LogHistoryDIToken, () => history);
            },
        });
        h.workbench.openFile(ws.path("alpha.txt"));
        h.commands.execute(TOGGLE_OUTPUT);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("живая запись в Output не гасит область редактора", () => {
        // Хвост дёргает onDidChangeEditors → группа пере-вставляла контент по
        // focus-aware активному редактору и подсовывала себе Output вместо файла:
        // весь центр экрана оказывался пустым.
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("AAAA");

        logService.createLogger("bootstrap").info("tail");

        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("AAAA");
    });

    it("Ctrl+W при фокусе в Output спрашивает про несохранённую вкладку", () => {
        // dirty спрашивали у focus-aware активного редактора — Output никогда не
        // modified, и изменённая вкладка закрывалась бы молча.
        const editorService = h.container.get(EditorServiceDIToken);
        const tab = editorService.getEditors()[0];
        tab.viewState.type("X");
        expect(tab.isModified).toBe(true);
        let asked = -1;
        editorService.onRequestConfirmClose = (_group, index) => {
            asked = index;
        };

        h.commands.execute("workbench.action.closeActiveEditor");

        expect(asked).toBe(0);
        expect(editorService.editorCount).toBe(1);
    });

    it("Ctrl+S при фокусе в Output сохраняет вкладку, а не уводит в Save As", () => {
        const tab = h.container.get(EditorServiceDIToken).getEditors()[0];
        tab.viewState.type("X");

        h.commands.execute("workbench.action.files.save");

        expect(tab.isModified).toBe(false);
    });

    it("персист активной вкладки переживает фокус в панели", () => {
        const stateService = h.container.get(WorkbenchStateServiceDIToken);

        stateService.captureOpenEditors();

        // Активная вкладка — открытый файл; Output пути на диске не имеет, и
        // индекс схлопывался бы в -1.
        expect(h.container.get(EditorServiceDIToken).getActiveTabEditor()?.absoluteFilePath).toBe(ws.path("alpha.txt"));
    });
});

describe("Workbench — Output: пустые каналы", () => {
    it("канал без записей открывается пустым редактором, а не падением", () => {
        // Реестр пред-заполнен известными каналами, поэтому активный канал есть
        // всегда — даже когда в него ещё ничего не написали (профиль тестов даёт
        // NULL_LOG_SERVICE). Это и есть поведение VS Code: вкладка открыта, канал
        // выбран, содержимое пустое.
        const ws = createTempWorkspace({ prefix: "diode-output-empty-" });
        const h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 32) });

        h.commands.execute(TOGGLE_OUTPUT);

        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("OUTPUT");
        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBe("bootstrap");
        h.dispose();
        ws.dispose();
    });

    it("с пустым реестром вкладка показывает placeholder", () => {
        // Ветка «активного канала нет вовсе»: в приложении недостижима, потому что
        // реестр заполняется в DI-модуле, но контракт компонента обязан её держать —
        // иначе пустой реестр давал бы редактор без канала.
        const ws = createTempWorkspace({ prefix: "diode-output-noreg-" });
        const h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            containerOverrides: (container) => {
                const empty = new OutputChannelRegistry();
                container.bind(OutputChannelRegistryDIToken, () => empty);
            },
        });

        h.commands.execute(TOGGLE_OUTPUT);

        h.testApp.render();
        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBeNull();
        expect(h.testApp.backend.screenToString()).toContain("No output yet.");
        h.dispose();
        ws.dispose();
    });
});

describe("Workbench — Output: редактор вне таб-строки", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-output-pane-", files: { "alpha.txt": "Alpha" } });
        const logService = new LogService();
        const history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap").info("hello");
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
                container.bind(LogHistoryDIToken, () => history);
            },
        });
        h.workbench.openFile(ws.path("alpha.txt"));
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Output не появляется во вкладках редакторов", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        const editorService = h.container.get(EditorServiceDIToken);
        expect(editorService.editorCount).toBe(1);
        expect(editorService.getEditors()[0].fileName).toBe("alpha.txt");
    });

    it("пока фокус в Output, активный редактор — он, а не файл за панелью", () => {
        // Иначе стрелки и Ctrl+F в панели правили бы/двигали курсор в файле.
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);

        const active = editorService.getActiveEditor();

        expect(active?.uri.scheme).toBe("output");
    });

    it("Output read-only: набор в него не проходит", () => {
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);
        const active = editorService.getActiveEditor();
        const before = active?.getText();

        h.testApp.sendKey("X");

        expect(active?.getText()).toBe(before);
    });

    it("скрытие панели уводит фокус во вкладку, а не обратно в Output", () => {
        // `PanelFocusContribution` зовёт `focusEditor()`, чтобы фокус не остался на
        // невидимом виджете. Если бы focusEditor ходил через focus-aware
        // getActiveEditor, он вернул бы фокус в ту же скрытую панель — и ввод
        // продолжал бы уходить в никуда.
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);
        expect(editorService.getActiveEditor()?.uri.scheme).toBe("output");

        h.commands.execute(TOGGLE_OUTPUT);

        // Ассерт именно на то, ГДЕ фокус: `getActiveEditor()` вернул бы вкладку и
        // в сломанном варианте — там contribution просто обнуляет фокус, увидев,
        // что тот не сдвинулся. Наблюдаемая разница — попал ли он в файл.
        const tabEditor = editorService.getEditors()[0];
        const focused = h.testApp.focusedElement;
        expect(focused).not.toBeNull();
        expect(focused!.getAncestorPath()).toContain(tabEditor.view);
    });

    it("после ухода фокуса из панели активным снова становится файл", () => {
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);
        expect(editorService.getActiveEditor()?.uri.scheme).toBe("output");

        h.workbench.focusEditor();

        expect(editorService.getActiveEditor()?.fileName).toBe("alpha.txt");
    });
});
