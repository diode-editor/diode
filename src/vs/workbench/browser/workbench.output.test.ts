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

    it("registers the OUTPUT tab between PROBLEMS and TERMINAL", () => {
        const panel = h.workbench.workbenchLayout.getBottomPanel();
        expect(panel).not.toBeNull();
        h.commands.execute(TOGGLE_OUTPUT);
        expect(frame()).toContain("OUTPUT");
    });

    it("shows the active channel's entries in the frame", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        expect(frame()).toContain("diode starting");
    });

    it("switching the channel repaints the content", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        expect(frame()).toContain("diode starting");

        outputService().showChannel("configuration");

        const text = frame();
        expect(text).toContain("settings.json is empty");
        expect(text).not.toContain("diode starting");
    });

    it("the live tail appends a line without reopening the tab", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        logService.createLogger("bootstrap").info("extension host started");

        expect(frame()).toContain("extension host started");
    });

    it("an entry in an inactive channel does not reach the frame", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        logService.createLogger("configuration").info("not shown");

        expect(frame()).not.toContain("not shown");
    });

    it("the entry level is bracketed to match the log grammar", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        expect(frame()).toContain("[info] diode starting");
    });

    it("entries written before the tab opens are not lost: they are in the frame on open", () => {
        // The editor is created lazily, so a tail that arrived earlier must come
        // from history instead of getting lost between the service and the editor.
        logService.createLogger("bootstrap").info("before opening");

        h.commands.execute(TOGGLE_OUTPUT);

        expect(frame()).toContain("before opening");
    });

    it("reopening the tab does not duplicate the content", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        h.commands.execute(TOGGLE_OUTPUT);
        h.commands.execute(TOGGLE_OUTPUT);

        const occurrences = frame().split("diode starting").length - 1;
        expect(occurrences).toBe(1);
    });

    it("clicking the OUTPUT tab fills it, not only the command", () => {
        // A tab click goes through `activateView`, the toggle command through `setActiveView`
        // without an activation event: without an activateView subscription the tab would be empty.
        const panelService = h.container.get(PanelServiceDIToken);
        h.commands.execute("workbench.action.togglePanel");

        panelService.activateView(OUTPUT_VIEW_ID);

        expect(frame()).toContain("diode starting");
    });

    it("revealing the panel container fills the tab (descriptor focus seam)", () => {
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

    it("the log background is the panel background, not the editor's", () => {
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

    it("activating a sibling panel tab does not touch Output", () => {
        h.commands.execute(TOGGLE_OUTPUT);
        const panelService = h.container.get(PanelServiceDIToken);

        panelService.activateView(PROBLEMS_VIEW_ID);

        expect(outputService().getActiveChannelId()).toBe("bootstrap");
    });
});

describe("Workbench: Output channel selector", () => {
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

    it("the selector caption is the active channel's label, not the raw id", () => {
        expect(frame()).toContain("Bootstrap");
        expect(frame()).not.toContain("PROBLEMS  OUTPUT  TERMINAL   bootstrap");
    });

    it("the header selector is not duplicated by a ⋯ button with the same list", () => {
        // No "⋯" button: its only item duplicated the selector; in VS Code a submenu
        // with `isSelection` renders as a SelectBox and stays out of the overflow.
        const tabRow = frame()
            .split("\n")
            .find((line) => line.includes("PROBLEMS  OUTPUT  TERMINAL"));
        expect(tabRow).toContain("Bootstrap");
        expect(tabRow).not.toContain("⋯");
    });

    it("the caption follows the channel switch", () => {
        h.container.get(OutputServiceDIToken).showChannel("configuration");

        const text = frame();
        expect(text).toContain("Configuration");
        expect(text).toContain("empty settings");
    });

    it("a channel is registered as a command, visible in the command palette too", () => {
        // The channel is registered after the panel comes up (the extension host starts later) —
        // the label must still reach both the selector and the command palette.
        h.container.get(ILogServiceDIToken).createLogger("extensions.host", { label: "Extension Host" });
        const titles = h.commands.listCommands().map((c) => c.title);
        expect(titles).toContain("Output: Show Extension Host");
    });

    it("the channel command switches the active channel", () => {
        h.commands.execute("workbench.action.output.show.configuration");

        expect(h.container.get(OutputServiceDIToken).getActiveChannelId()).toBe("configuration");
        expect(frame()).toContain("Configuration");
    });

    it("the active channel is checked in the submenu; the selector caption relies on it", () => {
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

    it("picking in the selector switches the channel through the same command", () => {
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

    it("a channel added at runtime reaches the selector", () => {
        const logService = h.container.get(ILogServiceDIToken);
        logService.createLogger("brand.new").info("hi");

        const menu = h.container.get(MenuServiceDIToken).createMenu(SwitchOutputMenu);
        const labels = menu.getEntries().map((e) => (e.type === "separator" ? "" : e.label));
        expect(labels).toContain("brand.new");
        menu.dispose();
    });

    it("a channel added again does not duplicate the selector item", () => {
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
describe("Workbench: Output regressions", () => {
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

    it("BUG-1: switching the channel keeps focus", () => {
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

    it("BUG-2: read-only cannot be removed from the Output panel", () => {
        const pane = outputPane();
        const before = pane.getText();

        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");
        h.testApp.sendKey("X");

        expect(pane.readOnly).toBe(true);
        expect(pane.getText()).toBe(before);
    });

    it("BUG-2: read-only still toggles on a regular tab", () => {
        // Control: the guard must not block the command where it is actually needed.
        h.workbench.focusEditor();

        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");

        expect(h.container.get(EditorServiceDIToken).getEditors()[0].readOnly).toBe(true);
    });

    it("BUG-2: the extension sees the tab, not the Output panel", () => {
        outputPane();

        const adapter = new EditorOptionsServiceAdapter(
            h.container.get(EditorServiceDIToken),
            h.container.get(EditorGroupsServiceDIToken),
            NO_BULK_EDITS,
        );

        expect(adapter.getActiveEditorMeta().uri).toBe(Uri.file(ws.path("alpha.txt")).toString());
    });

    it("BUG-3: the live tail does not collapse the selection", () => {
        const pane = outputPane();
        pane.viewState.selections = [createSelection(0, 0, 0, 5)];
        const selected = pane.viewState.getSelectedText();
        expect(selected).toHaveLength(5);

        logService.createLogger("bootstrap").info("tail arrives");

        expect(pane.viewState.getSelectedText()).toBe(selected);
    });

    it("BUG-3: the tail does not drag the viewport while older lines are being read", () => {
        const pane = outputPane();
        for (let i = 0; i < 50; i++) logService.createLogger("bootstrap").info(`line ${String(i)}`);
        pane.goToPosition(0, 0);

        logService.createLogger("bootstrap").info("newest");

        expect(pane.viewState.selections[0].active.line).toBe(0);
    });

    it("BUG-3: auto-scroll keeps working at the end of the document", () => {
        // Control: the guard must not kill autoscroll itself.
        const pane = outputPane();
        const before = pane.viewState.selections[0].active.line;

        logService.createLogger("bootstrap").info("newest");

        expect(pane.viewState.selections[0].active.line).toBeGreaterThan(before);
    });

    it("BUG-4: Ctrl+F with focus in Output searches the log, not the file behind the panel", () => {
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

    it("BUG-6: after session restore the tab is filled right away", () => {
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
describe("Workbench: Output consumers that need the tab", () => {
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

    it("a live write to Output does not blank the editor area", () => {
        // The tail fires onDidChangeEditors → the group re-inserted content from the
        // focus-aware active editor and swapped in Output instead of the file:
        // the whole center of the screen went blank.
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("AAAA");

        logService.createLogger("bootstrap").info("tail");

        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("AAAA");
    });

    it("Ctrl+W with focus in Output asks about the unsaved tab", async () => {
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

    it("Ctrl+S with focus in Output saves the tab instead of going to Save As", async () => {
        const tab = h.container.get(EditorServiceDIToken).getEditors()[0];
        tab.viewState.type("X");

        h.commands.execute("workbench.action.files.save");

        await vi.waitFor(() => {
            expect(tab.isModified).toBe(false);
        });
    });

    it("persisting the active tab survives focus in the panel", () => {
        const stateService = h.container.get(WorkbenchStateServiceDIToken);

        stateService.captureOpenEditors();

        // The active tab is an open file; Output has no path on disk, and
        // the index would collapse to -1.
        expect(h.container.get(EditorServiceDIToken).getActiveTabEditor()?.absoluteFilePath).toBe(ws.path("alpha.txt"));
    });
});

describe("Workbench: Output empty channels", () => {
    it("a channel without entries opens as an empty editor instead of crashing", () => {
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

    it("with an empty registry the tab shows a placeholder", () => {
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

describe("Workbench: Output editor outside the tab strip", () => {
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

    it("Output does not appear among editor tabs", () => {
        h.commands.execute(TOGGLE_OUTPUT);

        const editorService = h.container.get(EditorServiceDIToken);
        expect(editorService.editorGroups.activeGroup.editorCount).toBe(1);
        expect(editorService.getEditors()[0].fileName).toBe("alpha.txt");
    });

    it("while focus is in Output, it is the active editor, not the file behind the panel", () => {
        // Otherwise arrows and Ctrl+F in the panel would edit / move the cursor in the file.
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);

        const active = editorService.getActiveEditor();

        expect(active?.uri.scheme).toBe("output");
    });

    it("Output is read-only: typing into it does nothing", () => {
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);
        const active = editorService.getActiveEditor();
        const before = active?.getText();

        h.testApp.sendKey("X");

        expect(active?.getText()).toBe(before);
    });

    it("hiding the panel moves focus to the tab, not back to Output", () => {
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

    it("after focus leaves the panel the file becomes active again", () => {
        const editorService = h.container.get(EditorServiceDIToken);
        h.commands.execute(TOGGLE_OUTPUT);
        expect(editorService.getActiveEditor()?.uri.scheme).toBe("output");

        h.workbench.focusEditor();

        expect(editorService.getActiveEditor()?.fileName).toBe("alpha.txt");
    });
});
