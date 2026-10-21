import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import type { IBulkEditService } from "../contrib/bulkEdit/common/iBulkEditService.ts";
import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { PROBLEMS_VIEW_ID } from "../contrib/markers/browser/problemsComponent.ts";
import { SwitchOutputMenu } from "../contrib/output/browser/outputChannelActions.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { LogHistoryDIToken, OUTPUT_VIEW_ID, OutputChannelRegistryDIToken } from "../services/output/common/output.ts";
import { OutputChannelRegistry } from "../services/output/common/outputChannelRegistry.ts";
import { OutputServiceDIToken } from "../services/output/common/outputService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import type { TextEditorPane } from "./parts/editor/textEditorPane.ts";
import { PanelServiceDIToken } from "./parts/panel/panelService.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchStateServiceDIToken } from "./workbenchStateService.ts";
const NO_BULK_EDITS: IBulkEditService = { applyWorkspaceEdit: () => Promise.resolve(false) };

const TOGGLE_OUTPUT = "workbench.action.output.toggleOutput";

describe("Workbench — Output panel", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let logService: LogService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-output-", files: { "alpha.txt": "Alpha" } });
        // Real LogService + RingBufferSink: the log → buffer → panel chain is what's under test.
        logService = new LogService();
        const history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap", { label: "Bootstrap" }).info("diode starting");
        logService.createLogger("configuration", { label: "Configuration" }).warn("settings.json is empty");

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
        // The editor is created lazily, so a tail that arrived earlier must come
        // from history instead of getting lost between the service and the editor.
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
        // A tab click goes through `activateView`, the toggle command through `setActiveView`
        // without an activation event: without an activateView subscription the tab would be empty.
        const panelService = h.container.get(PanelServiceDIToken);
        h.commands.execute("workbench.action.togglePanel");

        panelService.activateView(OUTPUT_VIEW_ID);

        expect(frame()).toContain("diode starting");
    });

    it("reveal контейнера панели наполняет вкладку (шов focus дескриптора)", () => {
        const outputTab = (): TUIElement =>
            h.container
                .get(PanelServiceDIToken)
                .getViews()
                .find((v) => v.id === OUTPUT_VIEW_ID)!.content!;
        const placeholder = "#viewPlaceholder-workbench-panel-output";
        expect(outputTab().querySelector(placeholder)).not.toBeNull();

        h.container.get(ViewsServiceDIToken).focusContainer(OUTPUT_VIEW_ID);

        expect(outputTab().querySelector(placeholder)).toBeNull();
    });

    it("фон лога — фон панели, а не редактора", () => {
        // editor.background stood out as a rectangle inside the panel (Dark+: #181818 vs #1E1E1E).
        const theme = h.container.get(ThemeServiceDIToken).theme;
        const panelBg = theme.getRequiredColor("panel.background");
        expect(panelBg).not.toBe(theme.getRequiredColor("editor.background"));

        h.commands.execute(TOGGLE_OUTPUT);
        h.testApp.render();

        const editor = h.container.get(EditorServiceDIToken).getActiveEditor()!.view.getChild();
        const origin = editor.globalPosition;
        // The gutter and the last viewport line use the editor's "empty" background.
        expect(h.testApp.backend.getBgAt(new Point(origin.x, origin.y))).toBe(panelBg);
        expect(h.testApp.backend.getBgAt(new Point(origin.x, origin.y + editor.layoutSize.height - 1))).toBe(panelBg);
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
        logService.createLogger("bootstrap", { label: "Bootstrap" }).info("diode starting");
        logService.createLogger("configuration", { label: "Configuration" }).warn("empty settings");
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
        expect(frame()).toContain("Bootstrap");
        expect(frame()).not.toContain("PROBLEMS  OUTPUT  TERMINAL   bootstrap");
    });

    it("селектор в шапке не дублируется кнопкой «⋯» с тем же списком", () => {
        // No "⋯" button: its only item duplicated the selector; in VS Code a submenu
        // with `isSelection` renders as a SelectBox and stays out of the overflow.
        const tabRow = frame()
            .split("\n")
            .find((line) => line.includes("PROBLEMS  OUTPUT  TERMINAL"));
        expect(tabRow).toContain("Bootstrap");
        expect(tabRow).not.toContain("⋯");
    });

    it("подпись идёт за сменой канала", () => {
        h.container.get(OutputServiceDIToken).showChannel("configuration");

        const text = frame();
        expect(text).toContain("Configuration");
        expect(text).toContain("empty settings");
    });

    it("канал зарегистрирован как команда — её видно и в палитре", () => {
        // The channel is registered after the panel comes up (the extension host starts later) —
        // the label must still reach both the selector and the command palette.
        h.container.get(ILogServiceDIToken).createLogger("extensions.host", { label: "Extension Host" });
        const titles = h.commands.listCommands().map((c) => c.title);
        expect(titles).toContain("Output: Show Extension Host");
    });

    it("команда канала переключает активный канал", () => {
        h.commands.execute("workbench.action.output.show.configuration");

        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBe("configuration");
        expect(frame()).toContain("Configuration");
    });

    it("активный канал помечен в submenu — на нём держится подпись селектора", () => {
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
        // Selection runs `workbench.action.output.show.<id>` instead of calling the service:
        // mouse and command palette share one route.
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
        // A channel arrives both from the registry and from the live stream — registration is idempotent.
        const logService = h.container.get(ILogServiceDIToken);
        logService.createLogger("brand.new").info("one");
        logService.createLogger("brand.new").info("two");

        const menu = h.container.get(MenuServiceDIToken).createMenu(SwitchOutputMenu);
        const labels = menu.getEntries().map((e) => (e.type === "separator" ? "" : e.label));
        expect(labels.filter((l) => l === "brand.new")).toHaveLength(1);
        menu.dispose();
    });
});

/** Regressions from the black-box run of PR #197: each case reproduces a report. */
describe("Workbench — Output: регрессии", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let h: IAppHarness;
    let logService: LogService;
    let history: RingBufferSink;
    let writers: StateService[];

    function newState(): StateService {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        writers.push(state);
        return state;
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
        writers = [];
        logService = new LogService();
        history = new RingBufferSink();
        logService.addSink(history);
        logService.createLogger("bootstrap", { label: "Bootstrap" }).info("diode starting");
        logService.createLogger("configuration", { label: "Configuration" }).warn("empty settings");
        h = boot(newState());
    });

    afterEach(() => {
        h.dispose();
        // Silence the writers BEFORE removing the directories: a debounced write firing
        // after `rmSync` recreates the directory (`mkdir` with `recursive`).
        for (const writer of writers) writer.dispose();
        ws.dispose();
        userData.dispose();
    });

    function outputPane(): TextEditorPane {
        h.commands.execute(TOGGLE_OUTPUT);
        const pane = h.container.get(EditorServiceDIToken).getActiveEditor();
        expect(pane?.uri.scheme).toBe("output");
        return pane!;
    }

    it("BUG-1: смена канала не теряет фокус", () => {
        // `replaceOwnedContent` rebuilds the `EditorElement`; the old one left the tree
        // along with focus, and keystrokes went nowhere.
        outputPane();

        h.container.get(OutputServiceDIToken).showChannel("configuration");

        // Assert on the live widget: an editor detached from the tree keeps its parent reference,
        // so "focus somewhere under the panel" would pass even with broken focus.
        const pane = h.container.get(EditorServiceDIToken).getActiveEditor();
        expect(pane?.uri.scheme).toBe("output");
        expect(h.testApp.focusedElement).toBe(pane!.view.getChild());

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
        // Control: the guard must not block the command where it is actually needed.
        h.workbench.focusEditor();

        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");

        expect(h.container.get(EditorServiceDIToken).getEditors()[0].readOnly).toBe(true);
    });

    it("BUG-2: расширение видит вкладку, а не панель Output", () => {
        outputPane();

        const adapter = new EditorOptionsServiceAdapter(
            h.container.get(EditorServiceDIToken),
            h.container.get(EditorGroupsServiceDIToken),
            NO_BULK_EDITS,
        );

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
        // Control: the guard must not kill autoscroll itself.
        const pane = outputPane();
        const before = pane.viewState.selections[0].active.line;

        logService.createLogger("bootstrap").info("newest");

        expect(pane.viewState.selections[0].active.line).toBeGreaterThan(before);
    });

    it("BUG-4: Ctrl+F при фокусе в Output ищет по логу, а не по файлу за панелью", () => {
        // `diode starting` exists only in the log, `Alpha` only in the file.
        outputPane();
        const find = h.container.get(FindComponentDIToken);
        const groupId = h.container.get(EditorServiceDIToken).editorGroups.activeGroup.id;

        h.commands.execute("actions.find");
        const widget = find.widgetFor(groupId)!;
        widget.setQuery("diode starting");
        widget.onQueryChange?.("diode starting");

        h.testApp.render();
        expect(h.testApp.backend.screenToString()).not.toContain("No results");
    });

    it("BUG-6: после восстановления сессии вкладка сразу наполнена", () => {
        // The panel stayed open on OUTPUT — on the next launch there is no activation
        // event, so the content must load by itself.
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
 * Focus-aware `getActiveEditor()` hands the detached panel to everyone, and
 * consumers with tab semantics break on it in different ways.
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
        // The tail fires onDidChangeEditors → the group re-inserted content from the
        // focus-aware active editor and swapped in Output instead of the file:
        // the whole center of the screen went blank.
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("AAAA");

        logService.createLogger("bootstrap").info("tail");

        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("AAAA");
    });

    it("Ctrl+W при фокусе в Output спрашивает про несохранённую вкладку", async () => {
        // dirty was asked of the focus-aware active editor — Output is never
        // modified, so a modified tab would close silently.
        const editorService = h.container.get(EditorServiceDIToken);
        const tab = editorService.getEditors()[0];
        tab.viewState.type("X");
        expect(tab.isModified).toBe(true);

        h.commands.execute("workbench.action.closeActiveEditor");
        await Promise.resolve();

        expect(h.container.get(DialogServiceDIToken).getOpenConfirmSaveDialog()).not.toBeNull();
        expect(editorService.editorGroups.activeGroup.editorCount).toBe(1);
    });

    it("Ctrl+S при фокусе в Output сохраняет вкладку, а не уводит в Save As", async () => {
        const tab = h.container.get(EditorServiceDIToken).getEditors()[0];
        tab.viewState.type("X");

        h.commands.execute("workbench.action.files.save");

        await vi.waitFor(() => {
            expect(tab.isModified).toBe(false);
        });
    });

    it("персист активной вкладки переживает фокус в панели", () => {
        const stateService = h.container.get(WorkbenchStateServiceDIToken);

        stateService.captureOpenEditors();

        // The active tab is an open file; Output has no path on disk, and
        // the index would collapse to -1.
        expect(h.container.get(EditorServiceDIToken).getActiveTabEditor()?.absoluteFilePath).toBe(ws.path("alpha.txt"));
    });
});

describe("Workbench — Output: пустые каналы", () => {
    it("канал без записей открывается пустым редактором, а не падением", () => {
        // As in VS Code: a labeled channel is visible from logger creation, even when empty.
        const ws = createTempWorkspace({ prefix: "diode-output-empty-" });
        const logService = new LogService();
        logService.createLogger("bootstrap", { label: "Bootstrap" });
        const h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 32),
            containerOverrides: (container) => {
                container.bind(ILogServiceDIToken, () => logService);
            },
        });

        h.commands.execute(TOGGLE_OUTPUT);

        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("OUTPUT");
        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBe("bootstrap");
        h.dispose();
        ws.dispose();
    });

    it("с пустым реестром вкладка показывает placeholder", () => {
        // The "no active channel at all" branch: unreachable in the app, because
        // bootstrap registers labeled channels before the UI comes up, but the component contract
        // must hold it — otherwise an empty registry would yield an editor without a channel.
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
        expect(editorService.editorGroups.activeGroup.editorCount).toBe(1);
        expect(editorService.getEditors()[0].fileName).toBe("alpha.txt");
    });

    it("пока фокус в Output, активный редактор — он, а не файл за панелью", () => {
        // Otherwise arrows and Ctrl+F in the panel would edit / move the cursor in the file.
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
        // `PanelFocusContribution` calls `focusEditor()`; if it went through the focus-aware
        // getActiveEditor, focus would return to the hidden panel.
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);
        expect(editorService.getActiveEditor()?.uri.scheme).toBe("output");

        h.commands.execute(TOGGLE_OUTPUT);

        // Assert on WHERE focus is: `getActiveEditor()` would return the tab even in the broken
        // variant. The observable difference is whether focus landed in the file.
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
