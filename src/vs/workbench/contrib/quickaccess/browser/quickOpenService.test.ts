import { Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { charMask } from "../../../../base/common/fuzzySearch.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { type ServiceAccessor, token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import type { QuickPickElement } from "../../../browser/parts/quickinput/quickPickElement.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { FileSearchEntry, FileSearchResult } from "../../../services/search/common/fileSearch.ts";
import type { FileSearchService } from "../../../services/search/node/fileSearchService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";
import { QuickAccessRegistry } from "../common/quickAccessRegistry.ts";

import { CommandsQuickAccessProvider, CommandsQuickAccessProviderDIToken } from "./commandsQuickAccessProvider.ts";
import { FilesQuickAccessProvider, FilesQuickAccessProviderDIToken } from "./filesQuickAccessProvider.ts";
import type { IGotoLineEditor, IGotoLineEditorSource } from "./gotoLineQuickAccessProvider.ts";
import { GotoLineQuickAccessProvider, GotoLineQuickAccessProviderDIToken } from "./gotoLineQuickAccessProvider.ts";
import type { IOpenEditorsSource } from "./openEditorsQuickAccessProvider.ts";
import {
    OpenEditorsQuickAccessProvider,
    OpenEditorsQuickAccessProviderDIToken,
} from "./openEditorsQuickAccessProvider.ts";
import { QUICK_ACCESS_PROVIDERS } from "./quickAccessProviders.ts";
import { QuickOpenService } from "./quickOpenService.ts";

function makeComponent(): QuickInputComponent {
    return new QuickInputComponent();
}

interface FakeGotoLineEditor extends IGotoLineEditor {
    goToPosition: ReturnType<typeof vi.fn<(line: number, column?: number) => void>>;
}

function makeGotoLineEditor(lineCount = 100, cursorLine = 4, cursorColumn = 2): FakeGotoLineEditor {
    return {
        lineCount,
        primaryCursorLine: cursorLine,
        primaryCursorColumn: cursorColumn,
        goToPosition: vi.fn<(line: number, column?: number) => void>(),
    };
}

function makeFileEntry(relativePath: string, absolutePath = `/root/${relativePath}`): FileSearchEntry {
    const basename = relativePath.split("/").pop() ?? relativePath;
    const basenameLower = basename.toLowerCase();
    const relativePathLower = relativePath.toLowerCase();
    return {
        relativePath,
        absolutePath,
        basename,
        basenameLower,
        relativePathLower,
        basenameBits: charMask(basenameLower),
        relativePathBits: charMask(relativePathLower),
    };
}

function makeSearchResult(relativePath: string, matchedIndices: number[] = []): FileSearchResult {
    return { entry: makeFileEntry(relativePath), score: 100, matchedIndices };
}

function makeFileSearchStub(results: FileSearchResult[] = []): FileSearchService {
    const indexChanged = new Emitter<void>();
    return {
        fireIndexChanged: () => {
            indexChanged.fire();
        },
        hasIndexListeners: () => indexChanged.hasListeners(),
        search: vi.fn(() => results),
        activate: vi.fn(),
        refreshIfStale: vi.fn(),
        isIndexed: true,
        onIndexChanged: vi.fn(indexChanged.event),
        dispose: vi.fn(),
        register: vi.fn(),
    } as unknown as FileSearchService;
}

function fireIndexChanged(fileSearch: FileSearchService): void {
    (fileSearch as unknown as { fireIndexChanged(): void }).fireIndexChanged();
}

function makeOpenEditorPane(absolutePath: string, modified = false): IEditorPane {
    return {
        uri: Uri.file(absolutePath),
        label: absolutePath.split("/").pop() ?? absolutePath,
        isModified: modified,
    } as unknown as IEditorPane;
}

interface FakeOpenEditorsSource extends IOpenEditorsSource {
    revealed: IEditorPane[];
}

function makeOpenEditorsSource(panes: IEditorPane[] = []): FakeOpenEditorsSource {
    const revealed: IEditorPane[] = [];
    return {
        revealed,
        getOpenEditorsMru: () => panes,
        displayName: (editor) => editor.label,
        revealPane: (editor) => revealed.push(editor),
    };
}

function workspaceWithRoot(root: string): WorkspaceContextService {
    const workspace = new WorkspaceContextService();
    workspace.setWorkspaceFolder(root);
    return workspace;
}

function makeQuickAccessRegistry(deps: {
    fileSearch: FileSearchService;
    commands: CommandRegistry;
    keybindings: KeybindingRegistry;
    contextKeys: ContextKeyService;
    gotoSource: IGotoLineEditorSource;
    openEditors: IOpenEditorsSource;
    history: readonly Uri[];
}): QuickAccessRegistry {
    const instances = new Map<unknown, unknown>([
        [
            FilesQuickAccessProviderDIToken,
            new FilesQuickAccessProvider(
                deps.fileSearch,
                deps.commands,
                deps.gotoSource,
                NULL_JUMP_RECORDER,
                { getHistory: () => deps.history, removeMissing: () => Promise.resolve(false) },
                createTestConfigurationService(),
                workspaceWithRoot("/root"),
            ),
        ],
        [
            CommandsQuickAccessProviderDIToken,
            new CommandsQuickAccessProvider(
                deps.commands,
                deps.keybindings,
                deps.contextKeys,
                { isInCommandPalette: () => true },
                { getActiveEditor: () => null },
            ),
        ],
        [GotoLineQuickAccessProviderDIToken, new GotoLineQuickAccessProvider(deps.gotoSource, NULL_JUMP_RECORDER)],
        [
            OpenEditorsQuickAccessProviderDIToken,
            new OpenEditorsQuickAccessProvider(deps.openEditors, workspaceWithRoot("/root")),
        ],
    ]);
    const accessor: ServiceAccessor = {
        get: (diToken) => instances.get(diToken) as never,
    };
    return new QuickAccessRegistry(accessor, QUICK_ACCESS_PROVIDERS);
}

interface MutableGotoLineSource extends IGotoLineEditorSource {
    getActiveEditor: () => IGotoLineEditor | null;
}

function createService(
    fileResults: FileSearchResult[] = [],
    openPanes: IEditorPane[] = [],
    history: readonly Uri[] = [],
): {
    service: QuickOpenService;
    commands: CommandRegistry;
    keybindings: KeybindingRegistry;
    contextKeys: ContextKeyService;
    body: BodyElement;
    testApp: TestApp;
    fileSearch: FileSearchService;
    component: QuickInputComponent;
    view: QuickPickElement;
    gotoSource: MutableGotoLineSource;
    openEditors: FakeOpenEditorsSource;
} {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const fileSearch = makeFileSearchStub(fileResults);
    const component = makeComponent();
    const gotoSource: MutableGotoLineSource = { getActiveEditor: () => null };
    const openEditors = makeOpenEditorsSource(openPanes);
    const service = new QuickOpenService(
        makeQuickAccessRegistry({ fileSearch, commands, keybindings, contextKeys, gotoSource, openEditors, history }),
        component,
    );

    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);

    return {
        service,
        commands,
        keybindings,
        contextKeys,
        body,
        testApp,
        fileSearch,
        component,
        view: component.view,
        gotoSource,
        openEditors,
    };
}

describe("QuickOpenService — shared widget", () => {
    it("resets the multi-select mode left over from another show", () => {
        const { service, view } = createService();
        view.canPickMany = true;
        view.items = [{ label: "alpha" }];
        view.setCheckedItems(view.items);
        view.onAcceptMany = () => undefined;

        service.show();

        expect(view.canPickMany).toBe(false);
        expect([...view.checkedItems]).toEqual([]);
        expect(view.onAcceptMany).toBeNull();
    });

    it("removes the mask left over from another password input", () => {
        const { service, view } = createService();
        view.password = true;

        service.show();
        view.setQuery("readme");

        expect(view.password).toBe(false);
        expect(view.inspectState().query).toBe("readme");
    });

    it("after another multi-select, Enter in the palette runs the command again", async () => {
        const { service, view, commands } = createService();
        let executed = 0;
        commands.register(
            "test.quickOpenReset",
            () => {
                executed++;
            },
            "Test: Quick Open Reset",
        );
        view.canPickMany = true;
        view.onAcceptMany = () => undefined;

        service.show(CommandsQuickAccessProvider.PREFIX);
        view.setQuery(">Quick Open Reset");
        view.onQueryChange?.(view.getQuery());
        view.dispatchEvent(new TUIKeyboardEvent("keydown", { key: "Enter" }));
        await flushMicrotasks();

        expect(executed).toBe(1);
    });
});

describe("QuickOpenService — open/close", () => {
    it("picker is hidden by default", () => {
        const { body } = createService();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("open() makes picker visible", () => {
        const { service, body } = createService();
        service.show();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("close() hides picker", () => {
        const { service, body } = createService();
        service.show();
        service.close();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("open() sets focus to QuickPickElement", () => {
        const { service, testApp } = createService();
        service.show();
        expect(testApp.focusedElement?.constructor.name).toBe("InputElement");
    });

    it("open() when already open calls focus instead of re-opening", () => {
        const { service, body } = createService();
        service.show();
        const setVisibleSpy = vi.spyOn(body.overlayLayer, "setVisible");
        service.show();
        expect(setVisibleSpy).not.toHaveBeenCalled();
    });

    it("Escape key closes picker", () => {
        const { service, body, testApp } = createService();
        service.show();
        testApp.sendKey("Escape");
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("an outside pointer press closes the picker (closeOnOutsidePointer)", () => {
        const { service, body } = createService();
        service.show();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);

        // The press isn't swallowed and passes through — like quick pick in VS Code.
        body.dispatchEvent(
            new TUIMouseEvent("mousedown", {
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
                button: "left",
            }),
        );

        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("close() on a never-opened picker is a no-op", () => {
        const { service, fileSearch } = createService();
        service.close();
        expect(fileSearch.onIndexChanged).not.toHaveBeenCalled();
    });

    it("close() restores focus to previously focused element", () => {
        const { service, body, testApp } = createService();
        const dummyInput = new InputElement();
        dummyInput.focusable = true;
        body.setContent(dummyInput);
        testApp.app.root = body;
        dummyInput.focus();
        const prevFocused = testApp.focusedElement;

        service.show();
        service.close();

        expect(testApp.focusedElement).toBe(prevFocused);
    });
});

describe("QuickOpenService — files mode", () => {
    it("open('files') sets empty placeholder", () => {
        const { service, view } = createService();
        service.show();
        expect(view.placeholder).toBe("Go to File...");
    });

    it("an empty query lists the recent files without searching the index", () => {
        const { service, fileSearch, view } = createService(
            [makeSearchResult("src/other.ts")],
            [],
            [Uri.file("/root/src/b.ts"), Uri.file("/root/a.ts")],
        );
        service.show();
        expect(fileSearch.search).not.toHaveBeenCalled();
        expect(view.items.map((item) => [item.label, item.description])).toEqual([
            ["b.ts", "src"],
            ["a.ts", ""],
        ]);
    });

    it("open('files') kicks a throttled background re-index", () => {
        const { service, fileSearch } = createService();
        service.show();
        expect(fileSearch.refreshIfStale).toHaveBeenCalled();
    });

    it("index growing while open re-runs the current query", () => {
        const { service, fileSearch, view } = createService();
        service.show();
        view.setQuery("App");
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

        fireIndexChanged(fileSearch);

        expect(fileSearch.search).toHaveBeenCalledWith("App", 50);
    });

    it("a late index-changed callback after close does not re-run the search", () => {
        const { service, fileSearch } = createService();
        service.show();
        const handler = vi.mocked(fileSearch.onIndexChanged).mock.calls.at(-1)?.[0];
        expect(handler).toBeDefined();

        service.close();
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

        handler?.(undefined);
        expect(fileSearch.search).not.toHaveBeenCalled();
    });

    it("switching to command mode stops live file refreshes", () => {
        const { service, fileSearch, view } = createService();
        service.show();
        view.onQueryChange?.(">cmd");
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

        fireIndexChanged(fileSearch);

        expect(fileSearch.search).not.toHaveBeenCalled();
    });

    it("close() unsubscribes from index changes", () => {
        const { service, fileSearch } = createService();
        const hasIndexListeners = (): boolean =>
            (fileSearch as unknown as { hasIndexListeners(): boolean }).hasIndexListeners();
        service.show();
        expect(hasIndexListeners()).toBe(true);
        service.close();
        expect(hasIndexListeners()).toBe(false);
    });

    it("a background index refresh preserves the cursor mid-navigation", () => {
        // A huge monorepo: while the index streams in, the list is republished every ~50ms.
        const results = [
            makeSearchResult("src/a.ts"),
            makeSearchResult("src/b.ts"),
            makeSearchResult("src/c.ts"),
            makeSearchResult("src/d.ts"),
        ];
        const { service, testApp, fileSearch, view } = createService(results);
        service.show("src");

        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        expect(view.selectedIndex).toBe(2);

        fireIndexChanged(fileSearch);

        expect(view.selectedIndex).toBe(2);
        expect(view.items[2].label).toBe("c.ts");
    });

    it("a query change resets the cursor to the top", () => {
        const results = [makeSearchResult("src/a.ts"), makeSearchResult("src/b.ts"), makeSearchResult("src/c.ts")];
        const { service, testApp, view } = createService(results);
        service.show("src");

        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        expect(view.selectedIndex).toBe(2);

        view.onQueryChange?.("a");
        expect(view.selectedIndex).toBe(0);
    });

    it("items show basename as label and directory as description", () => {
        const results = [makeSearchResult("src/Controls/AppContainer.ts")];
        const { service, view } = createService(results);
        service.show("app");
        const items = view.items;
        expect(items[0].label).toBe("AppContainer.ts");
        expect(items[0].description).toBe("src/Controls");
    });

    it("file in root directory has empty description", () => {
        const results = [makeSearchResult("README.md")];
        const { service, view } = createService(results);
        service.show("readme");
        expect(view.items[0].description).toBe("");
    });

    it("typing triggers search with new query", () => {
        const { service, fileSearch, view } = createService();
        service.show();
        view.onQueryChange?.("App");
        expect(fileSearch.search).toHaveBeenCalledWith("App", 50);
    });

    it("match indices map to label highlight ranges", () => {
        // relativePath = "src/App.ts", basename = "App.ts" (offset=4)
        // indices [4, 5, 6] → basename indices [0, 1, 2] → one range [0, 3]
        const results: FileSearchResult[] = [
            {
                entry: makeFileEntry("src/App.ts"),
                score: 100,
                matchedIndices: [4, 5, 6],
            },
        ];
        const { service, view } = createService(results);
        service.show("app");
        const item = view.items[0];
        expect(item.labelMatchRanges).toEqual([[0, 3]]);
    });

    it("match indices in the directory portion map to description highlight ranges", () => {
        // relativePath = "src/App.ts", basename = "App.ts" (basenameOffset=4).
        // indices [0,1,2] are all < 4 → directory ("src") → merged range [0,3].
        const results: FileSearchResult[] = [
            {
                entry: makeFileEntry("src/App.ts"),
                score: 100,
                matchedIndices: [0, 1, 2],
            },
        ];
        const { service, view } = createService(results);
        service.show("src");
        const item = view.items[0];
        expect(item.descriptionMatchRanges).toEqual([[0, 3]]);
        expect(item.labelMatchRanges).toEqual([]);
    });

    it("non-adjacent directory matches produce separate description ranges", () => {
        // relativePath = "src/App.ts" → directory chars at offsets 0..2 ("src").
        // indices [0, 2] are non-adjacent → two separate ranges.
        const results: FileSearchResult[] = [
            {
                entry: makeFileEntry("src/App.ts"),
                score: 100,
                matchedIndices: [0, 2],
            },
        ];
        const { service, view } = createService(results);
        service.show("sa");
        const item = view.items[0];
        expect(item.descriptionMatchRanges).toEqual([
            [0, 1],
            [2, 3],
        ]);
    });

    it("matches spanning directory and basename split into both range sets", () => {
        // relativePath = "src/App.ts" (length 10), basename "App.ts" offset=4.
        // indices [2,3] → directory range [2,3]; indices [4,5] → label range [0,2].
        const results: FileSearchResult[] = [
            {
                entry: makeFileEntry("src/App.ts"),
                score: 100,
                matchedIndices: [2, 3, 4, 5],
            },
        ];
        const { service, view } = createService(results);
        service.show("cap");
        const item = view.items[0];
        expect(item.descriptionMatchRanges).toEqual([[2, 4]]);
        expect(item.labelMatchRanges).toEqual([[0, 2]]);
    });

    it("onAccept calls onExecuteCommand with workbench.openFile and absolutePath", async () => {
        const results = [makeSearchResult("src/main.ts", [])];
        const { service, commands, view } = createService(results);
        const execSpy = vi.spyOn(commands, "execute");
        service.show("main");

        const item = view.items[0] as QuickPickItem & { absolutePath: string };
        view.onAccept?.(item, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(execSpy).toHaveBeenCalledWith("workbench.openFile", "/root/src/main.ts");
    });

    it("accepting an item with neither commandId nor path does nothing", async () => {
        const { service, commands, body, view } = createService();
        const execSpy = vi.spyOn(commands, "execute");
        service.show();

        const bareItem: QuickPickItem = { label: "orphan" };
        view.onAccept?.(bareItem, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(execSpy).not.toHaveBeenCalled();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("accepting file closes the picker", async () => {
        const results = [makeSearchResult("src/main.ts")];
        const { service, commands, body, view } = createService(results);
        service.show("main");
        const item = view.items[0];
        view.onAccept?.(item, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });
});

describe("QuickOpenService — query prefill (show with text, not only a prefix)", () => {
    it("show('text') prefills the input and immediately filters files by it", () => {
        const { service, view, fileSearch } = createService([makeSearchResult("src/app.ts")]);
        service.show("app");
        expect(view.getQuery()).toBe("app");
        expect(fileSearch.search).toHaveBeenCalledWith("app", 50);
    });

    it("show('>text') activates command mode and filters by the text", () => {
        const { service, commands, view } = createService();
        commands.register("cmd.match", () => {}, "Open Settings");
        commands.register("cmd.other", () => {}, "Close Editor");
        service.show(">settings");
        expect(view.getQuery()).toBe(">settings");
        const labels = view.items.map((i) => i.label);
        expect(labels).toContain("Open Settings");
        expect(labels).not.toContain("Close Editor");
    });
});

describe("QuickOpenService — commands mode", () => {
    it("open('commands') sets placeholder", () => {
        const { service, commands, view } = createService();
        service.show(CommandsQuickAccessProvider.PREFIX);
        expect(view.placeholder).toBe("Show All Commands");
    });

    it("open('commands') sets '>' query", () => {
        const { service, commands, view } = createService();
        service.show(CommandsQuickAccessProvider.PREFIX);
        expect(view.getQuery()).toBe(">");
    });

    it("lists registered commands with titles", () => {
        const { service, commands, view } = createService();
        commands.register("cmd.a", () => {}, "Command A");
        commands.register("cmd.b", () => {}, "Command B");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const labels = view.items.map((i) => i.label);
        expect(labels).toContain("Command A");
        expect(labels).toContain("Command B");
    });

    it("a command that is currently unavailable is not shown in the palette", () => {
        function labelsWhenBusy(busy: boolean): string[] {
            const { service, commands, contextKeys, view } = createService();
            commands.register("git.commit", () => {}, "Git: Commit", "!gitOperationInProgress");
            commands.register("git.showOutput", () => {}, "Git: Show Output");
            contextKeys.set("gitOperationInProgress", busy);
            service.show(CommandsQuickAccessProvider.PREFIX);
            return view.items.map((i) => i.label);
        }

        const busy = labelsWhenBusy(true);
        expect(busy).not.toContain("Git: Commit");
        // A command without enablement stays: only disabled ones are hidden.
        expect(busy).toContain("Git: Show Output");
        expect(labelsWhenBusy(false)).toContain("Git: Commit");
    });

    it("commands without title are not listed", () => {
        const { service, commands, view } = createService();
        commands.register("cmd.hidden", () => {});
        commands.register("cmd.visible", () => {}, "Visible");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const labels = view.items.map((i) => i.label);
        expect(labels).toContain("Visible");
        expect(labels).not.toContain("cmd.hidden");
    });

    it("shows the keybinding shortcut for a command", () => {
        const { service, commands, keybindings, view } = createService();
        commands.register("cmd.save", () => {}, "File: Save");
        keybindings.register(parseKeybinding("ctrl+s"), "cmd.save");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items.find((i) => i.label === "File: Save");
        expect(item?.shortcut).toBe("Ctrl+S");
    });

    it("on mac (isMac) the shortcut is labeled with glyphs: ⌘K ⌘S", () => {
        const { service, commands, keybindings, contextKeys, view } = createService();
        commands.register("cmd.save", () => {}, "File: Save");
        keybindings.register(parseChord("mod+k mod+s"), "cmd.save");
        contextKeys.set("isMac", true);
        contextKeys.set("macKeys", 3);
        service.show(CommandsQuickAccessProvider.PREFIX);
        expect(view.items.find((i) => i.label === "File: Save")?.shortcut).toBe("⌘K ⌘S");
    });

    it("renders chord bindings as a space-separated sequence", () => {
        const { service, commands, keybindings, view } = createService();
        commands.register("cmd.save", () => {}, "File: Save");
        keybindings.register(parseChord("ctrl+k s"), "cmd.save");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items.find((i) => i.label === "File: Save");
        expect(item?.shortcut).toBe("Ctrl+K S");
    });

    it("shows no shortcut when the command has no binding", () => {
        const { service, commands, view } = createService();
        commands.register("cmd.x", () => {}, "Do X");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items.find((i) => i.label === "Do X");
        expect(item?.shortcut).toBeUndefined();
    });

    it("with multiple bindings shows the first registered", () => {
        const { service, commands, keybindings, view } = createService();
        commands.register("cmd.save", () => {}, "File: Save");
        keybindings.register(parseKeybinding("ctrl+s"), "cmd.save");
        keybindings.register(parseChord("ctrl+k s"), "cmd.save");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items.find((i) => i.label === "File: Save");
        expect(item?.shortcut).toBe("Ctrl+S");
    });

    it("with when-conditioned bindings shows the one matching the current context", () => {
        const { service, commands, keybindings, contextKeys, view } = createService();
        commands.register("cmd.go", () => {}, "Go");
        keybindings.register(parseKeybinding("ctrl+s"), "cmd.go", "textInputFocus");
        keybindings.register(parseKeybinding("ctrl+l"), "cmd.go", "listFocus");
        contextKeys.set("listFocus", true);
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items.find((i) => i.label === "Go");
        expect(item?.shortcut).toBe("Ctrl+L");
    });

    it("typing after '>' filters commands by title (case-insensitive)", () => {
        const { service, commands, view } = createService();
        commands.register("cmd.save", () => {}, "File: Save");
        commands.register("cmd.open", () => {}, "File: Open");
        commands.register("cmd.quit", () => {}, "Quit");
        service.show(CommandsQuickAccessProvider.PREFIX);
        view.onQueryChange?.(">save");
        const labels = view.items.map((i) => i.label);
        expect(labels).toContain("File: Save");
        expect(labels).not.toContain("File: Open");
        expect(labels).not.toContain("Quit");
    });

    it("onAccept fires onExecuteCommand with commandId", async () => {
        const { service, commands, view } = createService();
        commands.register("cmd.x", () => {}, "Do X");
        const execSpy = vi.spyOn(commands, "execute");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items[0];
        view.onAccept?.(item, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });
        expect(execSpy).toHaveBeenCalledWith("cmd.x");
    });

    it("accepting command closes the picker", async () => {
        const { service, commands, body, view } = createService();
        commands.register("cmd.x", () => {}, "Do X");
        service.show(CommandsQuickAccessProvider.PREFIX);
        const item = view.items[0];
        view.onAccept?.(item, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });
});

describe("QuickOpenService — mode switching via '>'", () => {
    it("typing '>' in file mode switches to command items", () => {
        const { service, commands, view } = createService();
        commands.register("cmd.a", () => {}, "Command A");
        service.show();
        view.onQueryChange?.(">Command");
        const labels = view.items.map((i) => i.label);
        expect(labels).toContain("Command A");
    });

    it("removing '>' switches back to file results", () => {
        const results = [makeSearchResult("src/main.ts")];
        const { service, view } = createService(results);
        service.show();
        view.onQueryChange?.(">foo");
        view.onQueryChange?.("main");
        const labels = view.items.map((i) => i.label);
        expect(labels).toContain("main.ts");
    });
});

describe("QuickOpenService — open editors mode", () => {
    function openThree(): { service: QuickOpenService; view: QuickPickElement; openEditors: FakeOpenEditorsSource } {
        const panes = [
            makeOpenEditorPane("/root/src/main.ts"),
            makeOpenEditorPane("/root/readme.md", true),
            makeOpenEditorPane("/root/src/vs/editor/core.ts"),
        ];
        const { service, view, openEditors } = createService([], panes);
        return { service, view, openEditors };
    }

    it("the `edt ` prefix selects the open editors picker, not file search", () => {
        const { service, view } = openThree();
        service.show(OpenEditorsQuickAccessProvider.PREFIX);
        expect(view.placeholder).toBe("Show All Opened Editors");
        expect(view.getQuery()).toBe("edt ");
    });

    it("the list is the open tabs in MRU order, with path and dirty marker", () => {
        const { service, view } = openThree();
        service.show(OpenEditorsQuickAccessProvider.PREFIX);
        expect(view.items.map((item) => item.label)).toEqual(["main.ts", "readme.md", "core.ts"]);
        expect(view.items.map((item) => item.description)).toEqual(["src", "", "src/vs/editor"]);
        expect(view.items.map((item) => item.hint)).toEqual([undefined, "●", undefined]);
    });

    it("typing filters the list with the same fuzzy as the file picker", () => {
        const { service, view } = openThree();
        service.show(OpenEditorsQuickAccessProvider.PREFIX);
        view.onQueryChange?.("edt cor");
        expect(view.items.map((item) => item.label)).toEqual(["core.ts"]);
        expect(view.items[0].labelMatchRanges).toEqual([[0, 3]]);
    });

    it("accepting a row switches to its tab", async () => {
        const { service, view, openEditors } = openThree();
        service.show(OpenEditorsQuickAccessProvider.PREFIX);
        view.onQueryChange?.("edt readme");

        // Accept is deferred to a microtask (the picker closes first) — same as for files.
        view.onAccept?.(view.items[0], 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(openEditors.revealed.map((pane) => pane.label)).toEqual(["readme.md"]);
    });

    it("erasing the prefix returns to file search", () => {
        const results = [makeSearchResult("src/main.ts")];
        const { service, view } = createService(results, [makeOpenEditorPane("/root/only-open.ts")]);
        service.show(OpenEditorsQuickAccessProvider.PREFIX);
        expect(view.items.map((item) => item.label)).toEqual(["only-open.ts"]);

        view.onQueryChange?.("main");

        expect(view.placeholder).toBe("Go to File...");
        expect(view.items.map((item) => item.label)).toEqual(["main.ts"]);
    });
});

describe("QuickOpenService — position and size", () => {
    it("open() sets preferredWidth to computed pickerW", () => {
        // 80-wide screen: pickerW = min(80, max(40, 80-4)) = 76
        const { service, view } = createService();
        service.show();
        expect(view.preferredWidth).toBe(76);
    });

    it("open() sets smaller pickerW on narrow screen", () => {
        const commands = new CommandRegistry();
        const fileSearch = makeFileSearchStub();
        const component = makeComponent();
        const svc = new QuickOpenService(
            makeQuickAccessRegistry({
                fileSearch,
                commands,
                keybindings: new KeybindingRegistry(),
                contextKeys: new ContextKeyService(),
                gotoSource: { getActiveEditor: () => null },
                openEditors: makeOpenEditorsSource(),
                history: [],
            }),
            component,
        );
        const body = new BodyElement();
        const testApp = TestApp.create(body, new Size(50, 24));
        component.attachHost(body);

        svc.show();
        // pickerW = min(80, max(40, 50-4)) = min(80, 46) = 46
        expect(component.view.preferredWidth).toBe(46);
        testApp.render();
        expect(component.view.layoutSize.width).toBe(46);
    });

    it("open() without an attached host is a no-op for positioning", () => {
        const commands = new CommandRegistry();
        const fileSearch = makeFileSearchStub();
        const component = makeComponent();
        const svc = new QuickOpenService(
            makeQuickAccessRegistry({
                fileSearch,
                commands,
                keybindings: new KeybindingRegistry(),
                contextKeys: new ContextKeyService(),
                gotoSource: { getActiveEditor: () => null },
                openEditors: makeOpenEditorsSource(),
                history: [],
            }),
            component,
        );

        expect(() => {
            svc.show();
        }).not.toThrow();
        expect(component.view.preferredWidth).toBe(60);
        expect(component.isOpen()).toBe(false);
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();
        fireIndexChanged(fileSearch);
        expect(fileSearch.search).not.toHaveBeenCalled();
    });

    it("picker is horizontally centred after layout", () => {
        const { service, testApp, view } = createService();
        service.show();
        testApp.render();
        // pickerW=76, screen=80: px = floor((80-76)/2) = 2
        expect(view.globalPosition.x).toBe(2);
    });

    it("picker width after layout matches preferredWidth", () => {
        const { service, testApp, view } = createService();
        service.show();
        testApp.render();
        expect(view.layoutSize.width).toBe(view.preferredWidth);
    });
});

describe("QuickOpenService — file-search debounce", () => {
    it("first keystroke after idle runs search synchronously (leading edge)", () => {
        const { service, fileSearch, view } = createService();
        service.show();
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

        view.onQueryChange?.("App");

        expect(fileSearch.search).toHaveBeenCalledTimes(1);
        expect(fileSearch.search).toHaveBeenLastCalledWith("App", 50);
    });

    it("a burst of keystrokes coalesces into one leading + one trailing run", () => {
        vi.useFakeTimers();
        try {
            const { service, fileSearch, view } = createService();
            service.show();
            (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

            view.onQueryChange?.("A");
            view.onQueryChange?.("Ap");
            view.onQueryChange?.("App");

            expect(fileSearch.search).toHaveBeenCalledTimes(1);
            expect(fileSearch.search).toHaveBeenLastCalledWith("A", 50);

            vi.runAllTimers();

            expect(fileSearch.search).toHaveBeenCalledTimes(2);
            expect(fileSearch.search).toHaveBeenLastCalledWith("App", 50);
        } finally {
            vi.useRealTimers();
        }
    });

    it("no trailing run when nothing changed during the cooldown", () => {
        vi.useFakeTimers();
        try {
            const { service, fileSearch, view } = createService();
            service.show();
            (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

            view.onQueryChange?.("App");
            vi.runAllTimers();

            expect(fileSearch.search).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("closing cancels a pending trailing run", () => {
        vi.useFakeTimers();
        try {
            const { service, fileSearch, view } = createService();
            service.show();
            (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

            view.onQueryChange?.("A");
            view.onQueryChange?.("Ap");
            service.close();

            vi.runAllTimers();

            expect(fileSearch.search).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("switching to command mode runs synchronously and drops a pending file search", () => {
        vi.useFakeTimers();
        try {
            const { service, fileSearch, view } = createService();
            service.show();
            (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

            view.onQueryChange?.("A");
            view.onQueryChange?.("Ap");
            view.onQueryChange?.(">cmd");

            vi.runAllTimers();

            expect(fileSearch.search).toHaveBeenCalledTimes(1);
            expect(fileSearch.search).toHaveBeenLastCalledWith("A", 50);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("QuickOpenService — go to line mode", () => {
    it("open('line') seeds a ':' query", () => {
        const { service, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => makeGotoLineEditor();
        service.show(GotoLineQuickAccessProvider.PREFIX);
        expect(view.getQuery()).toBe(":");
    });

    it("placeholder reports the current position and line count", () => {
        const { service, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => makeGotoLineEditor(340, 11, 6);
        service.show(GotoLineQuickAccessProvider.PREFIX);
        expect(view.placeholder).toBe(
            "Current Line: 12, Character: 7. Type a line number between 1 and 340 to navigate to.",
        );
    });

    it("shows an info hint before a number is typed", () => {
        const { service, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => makeGotoLineEditor(200);
        service.show(GotoLineQuickAccessProvider.PREFIX);
        expect(view.items).toHaveLength(1);
        expect(view.items[0].label).toBe("Type a line number between 1 and 200 to navigate to");
    });

    it("shows an actionable 'Go to line N' item once a number is typed", () => {
        const { service, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => makeGotoLineEditor();
        service.show(GotoLineQuickAccessProvider.PREFIX);
        view.onQueryChange?.(":42");
        expect(view.items[0].label).toBe("Go to line 42");
    });

    it("includes the column in the 'Go to line' label", () => {
        const { service, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => makeGotoLineEditor();
        service.show(GotoLineQuickAccessProvider.PREFIX);
        view.onQueryChange?.(":42:8");
        expect(view.items[0].label).toBe("Go to line 42:8");
    });

    it("accepting navigates the active editor to the 0-based position and closes", async () => {
        const editor = makeGotoLineEditor();
        const { service, body, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => editor;
        service.show(GotoLineQuickAccessProvider.PREFIX);
        view.onQueryChange?.(":42:8");

        view.onAccept?.(view.items[0], 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        // 1-based UI → 0-based document coordinates.
        expect(editor.goToPosition).toHaveBeenCalledWith(41, 7);
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("accepting the info hint is a no-op and keeps the picker open", async () => {
        const editor = makeGotoLineEditor();
        const { service, body, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => editor;
        service.show(GotoLineQuickAccessProvider.PREFIX);

        view.onAccept?.(view.items[0], 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(editor.goToPosition).not.toHaveBeenCalled();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("accepting is a safe no-op if the active editor vanished before accept", async () => {
        const editor = makeGotoLineEditor();
        const { service, body, view, gotoSource } = createService();
        // Present while building the item, gone by the time accept navigates.
        gotoSource.getActiveEditor = () => editor;
        service.show(GotoLineQuickAccessProvider.PREFIX);
        view.onQueryChange?.(":5");
        gotoSource.getActiveEditor = () => null;

        view.onAccept?.(view.items[0], 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(editor.goToPosition).not.toHaveBeenCalled();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("shows a fallback when there is no active editor", () => {
        const { service, view, gotoSource } = createService();
        gotoSource.getActiveEditor = () => null;
        service.show(GotoLineQuickAccessProvider.PREFIX);
        expect(view.placeholder).toBe("Go to line");
        expect(view.items[0].label).toBe("No active editor to navigate");
    });
});

describe("QuickOpenService — file:line suffix", () => {
    it("strips the ':line' suffix before searching so the colon does not pollute the filter", () => {
        const { service, fileSearch, view } = createService([makeSearchResult("src/main.ts")]);
        service.show();
        view.onQueryChange?.("main:42");
        expect(fileSearch.search).toHaveBeenLastCalledWith("main", 50);
    });

    it("strips a bare trailing colon (mid-typing) from the search query", () => {
        const { service, fileSearch, view } = createService([makeSearchResult("src/main.ts")]);
        service.show();
        view.onQueryChange?.("main:");
        expect(fileSearch.search).toHaveBeenLastCalledWith("main", 50);
    });

    it("opens the file then jumps to the parsed position", async () => {
        const editor = makeGotoLineEditor();
        const results = [makeSearchResult("src/main.ts")];
        const { service, commands, view, gotoSource } = createService(results);
        const execSpy = vi.spyOn(commands, "execute");
        gotoSource.getActiveEditor = () => editor;
        service.show();
        view.onQueryChange?.("main:42:8");

        view.onAccept?.(view.items[0], 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(execSpy).toHaveBeenCalledWith("workbench.openFile", "/root/src/main.ts");
        expect(editor.goToPosition).toHaveBeenCalledWith(41, 7);
    });

    it("opens the file without navigating when there is no line suffix", async () => {
        const editor = makeGotoLineEditor();
        const results = [makeSearchResult("src/main.ts")];
        const { service, view, gotoSource } = createService(results);
        gotoSource.getActiveEditor = () => editor;
        service.show();
        view.onQueryChange?.("main");

        view.onAccept?.(view.items[0], 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        expect(editor.goToPosition).not.toHaveBeenCalled();
    });
});

describe("QuickOpenService — recent files navigation", () => {
    const history = [Uri.file("/root/c.ts"), Uri.file("/root/b.ts"), Uri.file("/root/a.ts")];

    it("inQuickOpen / inFilesPicker follow the picker and its mode", () => {
        const { service, view, contextKeys } = createService([], [], history);
        const keys = (): unknown[] => {
            service.updateContextKeys(contextKeys);
            return [contextKeys.get("inQuickOpen"), contextKeys.get("inFilesPicker")];
        };

        expect(keys()).toEqual([false, false]);
        service.show();
        expect(keys()).toEqual([true, true]);
        view.onQueryChange?.("main");
        expect(keys()).toEqual([true, true]);
        view.onQueryChange?.(">");
        expect(keys()).toEqual([true, false]);
        view.onQueryChange?.("edt ");
        expect(keys()).toEqual([true, false]);
        view.onQueryChange?.("");
        expect(keys()).toEqual([true, true]);
        service.close();
        expect(keys()).toEqual([false, false]);
    });

    it("another session on the shared widget (a QuickInputService prompt) is in quick open, as upstream, but not the files picker", () => {
        const { service, component, contextKeys } = createService([], [], history);

        component.show();
        service.updateContextKeys(contextKeys);

        expect(component.isOpen()).toBe(true);
        expect(contextKeys.get("inQuickOpen")).toBe(true);
        expect(contextKeys.get("inFilesPicker")).toBe(false);
    });

    it("navigate steps the cursor like the arrows, clamped at the ends, keeping the query", () => {
        const { service, view } = createService([], [], history);
        service.show();

        service.navigate(true);
        service.navigate(true);
        expect(view.selectedIndex).toBe(2);
        service.navigate(true);
        expect(view.selectedIndex).toBe(2);
        service.navigate(false);
        expect(view.selectedIndex).toBe(1);
        service.navigate(false);
        service.navigate(false);
        expect(view.selectedIndex).toBe(0);
        expect(view.getQuery()).toBe("");
    });

    it("navigate on a closed picker does nothing", () => {
        const { service, view } = createService([], [], history);
        service.show();
        service.close();

        service.navigate(true);

        expect(view.selectedIndex).toBe(0);
    });

    it("activateSecond opens with the cursor on the previous file", () => {
        const { service, view } = createService([], [], history);

        service.show("", { activateSecond: true });

        expect(view.items[view.selectedIndex].label).toBe("b.ts");
    });

    it("without activateSecond the cursor is on the first row", () => {
        const { service, view } = createService([], [], history);

        service.show("");

        expect(view.selectedIndex).toBe(0);
    });
});

describe("QuickOpenService — provider hooks", () => {
    const ROWS: readonly QuickAccessItem[] = [
        { label: "one", accept: vi.fn() },
        { label: "two", accept: vi.fn() },
        { label: "three", accept: vi.fn() },
    ];

    function setup(overrides: Partial<IQuickAccessProvider> = {}): {
        service: QuickOpenService;
        component: QuickInputComponent;
        provider: IQuickAccessProvider;
        onActive: ReturnType<typeof vi.fn>;
        onHide: ReturnType<typeof vi.fn>;
    } {
        const onActive = vi.fn();
        const onHide = vi.fn();
        const provider: IQuickAccessProvider = {
            getPlaceholder: () => "hooks",
            getItems: () => [...ROWS],
            onActiveItemChanged: onActive,
            onHide,
            ...overrides,
        };
        const other: IQuickAccessProvider = { getPlaceholder: () => "other", getItems: () => [] };
        const hooksToken = token<IQuickAccessProvider>("hooks");
        const otherToken = token<IQuickAccessProvider>("other");
        const accessor: ServiceAccessor = {
            get: (diToken) => (diToken === hooksToken ? provider : other) as never,
        };
        const registry = new QuickAccessRegistry(accessor, [
            { prefix: "@", provider: hooksToken },
            { prefix: "", provider: otherToken },
        ]);
        const component = makeComponent();
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        return { service: new QuickOpenService(registry, component), component, provider, onActive, onHide };
    }

    it("the active row is reported on open, on user navigation and when new items change it", () => {
        const { service, component, onActive } = setup();
        service.show("@");
        expect(onActive).toHaveBeenLastCalledWith(ROWS[0]);

        component.view.moveActive(1);
        expect(onActive).toHaveBeenLastCalledWith(ROWS[1]);

        component.view.setQuery("@t");
        component.view.onQueryChange?.("@t");
        expect(onActive).toHaveBeenLastCalledWith(ROWS[0]);
    });

    it("no provider after the close: a late active row and a repeated close are ignored", () => {
        const { service, component, onActive, onHide } = setup();
        service.show("@");
        component.hide();
        onActive.mockClear();
        onHide.mockClear();

        component.view.onActiveItemChanged?.(ROWS[0], 0);
        component.onDidClose?.();

        expect(onActive).not.toHaveBeenCalled();
        expect(onHide).not.toHaveBeenCalled();
    });

    it("an empty list reports no row", () => {
        const { service, onActive } = setup({ getItems: () => [] });
        service.show("@");
        expect(onActive).toHaveBeenLastCalledWith(undefined);
    });

    it("the provider picks the starting row of a fresh list, and the report follows it", () => {
        const getInitialActiveIndex = vi.fn(() => 2);
        const { service, component, onActive } = setup({ getInitialActiveIndex });
        service.show("@x");
        expect(getInitialActiveIndex).toHaveBeenCalledWith(ROWS, "@x");
        expect(component.view.selectedIndex).toBe(2);
        expect(onActive).toHaveBeenLastCalledWith(ROWS[2]);
    });

    it("a refresh that keeps the cursor does not ask for a starting row, but a fresh one does", () => {
        let refresh: (preserveSelection: boolean) => void = () => undefined;
        const getInitialActiveIndex = vi.fn<() => number | undefined>(() => undefined);
        const { service, component } = setup({
            getInitialActiveIndex,
            onShow: (callback) => {
                refresh = callback;
            },
        });
        service.show("@");
        component.view.moveActive(1);
        getInitialActiveIndex.mockClear();

        refresh(true);
        expect(getInitialActiveIndex).not.toHaveBeenCalled();
        expect(component.view.selectedIndex).toBe(1);

        refresh(false);
        expect(getInitialActiveIndex).toHaveBeenCalledTimes(1);
        expect(component.view.selectedIndex).toBe(0);
    });

    it("Escape hides with `cancel`, and the next hide after an accept with `accept`", async () => {
        const { service, component, onHide } = setup();
        service.show("@");
        component.view.onCancel?.();
        expect(onHide).toHaveBeenLastCalledWith("cancel");

        service.show("@");
        component.view.onAccept?.(ROWS[0], 0);
        await flushMicrotasks();
        expect(onHide).toHaveBeenLastCalledWith("accept");
        expect(ROWS[0].accept).toHaveBeenCalled();

        service.show("@");
        service.close();
        expect(onHide).toHaveBeenLastCalledWith("cancel");
    });

    it("the hide comes before the accept, so a restore cannot undo the jump", async () => {
        const order: string[] = [];
        const item: QuickAccessItem = { label: "x", accept: () => order.push("accept") };
        const { service, component } = setup({
            getItems: () => [item],
            onHide: (reason) => order.push(`hide:${reason}`),
        });
        service.show("@");
        component.view.onAccept?.(item, 0);
        await flushMicrotasks();
        expect(order).toEqual(["hide:accept", "accept"]);
    });

    it("an informational row closes nothing and reports no hide", async () => {
        const item: QuickAccessItem = { label: "hint" };
        const { service, component, onHide } = setup({ getItems: () => [item] });
        service.show("@");
        component.view.onAccept?.(item, 0);
        await flushMicrotasks();
        expect(onHide).not.toHaveBeenCalled();
        expect(component.isOpen()).toBe(true);
    });

    it("leaving the prefix is a `cancel` for the provider being left", () => {
        const { service, component, onHide } = setup();
        service.show("@");
        component.view.setQuery("a");
        component.view.onQueryChange?.("a");
        expect(onHide).toHaveBeenCalledExactlyOnceWith("cancel");
    });

    it("inFileSymbolsPicker holds only while `@` is shown", () => {
        const { service, component } = setup();
        const keys = new ContextKeyService();
        service.show("@");
        service.updateContextKeys(keys);
        expect(keys.get("inFileSymbolsPicker")).toBe(true);
        expect(keys.get("inFilesPicker")).toBe(false);

        component.view.setQuery("a");
        component.view.onQueryChange?.("a");
        service.updateContextKeys(keys);
        expect(keys.get("inFileSymbolsPicker")).toBe(false);

        service.close();
        service.updateContextKeys(keys);
        expect(keys.get("inFileSymbolsPicker")).toBe(false);
    });
});
