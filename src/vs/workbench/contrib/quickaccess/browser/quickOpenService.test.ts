import { describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/all/ui/body/bodyElement";
import { InputElement } from "@tuidom/all/ui/inputbox/inputElement";
import type { QuickPickElement, QuickPickItem } from "@tuidom/all/ui/quickpick/quickPickElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { charMask } from "../../../../base/common/fuzzySearch.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import type {
    FileSearchEntry,
    FileSearchResult,
    FileSearchService,
} from "../../../services/search/node/fileSearchService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import { QuickAccessRegistry } from "../common/quickAccessRegistry.ts";

import { CommandsQuickAccessProvider, CommandsQuickAccessProviderDIToken } from "./commandsQuickAccessProvider.ts";
import { FilesQuickAccessProvider, FilesQuickAccessProviderDIToken } from "./filesQuickAccessProvider.ts";
import type { IGotoLineEditor, IGotoLineEditorSource } from "./gotoLineQuickAccessProvider.ts";
import { GotoLineQuickAccessProvider, GotoLineQuickAccessProviderDIToken } from "./gotoLineQuickAccessProvider.ts";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    return {
        search: vi.fn(() => results),
        activate: vi.fn(),
        refreshIfStale: vi.fn(),
        isIndexed: true,
        onIndexChanged: null,
        dispose: vi.fn(),
        register: vi.fn(),
    } as unknown as FileSearchService;
}

/** Реестр с настоящими провайдерами поверх стабов зависимостей (без DI-контейнера). */
function makeQuickAccessRegistry(deps: {
    fileSearch: FileSearchService;
    commands: CommandRegistry;
    keybindings: KeybindingRegistry;
    contextKeys: ContextKeyService;
    gotoSource: IGotoLineEditorSource;
}): QuickAccessRegistry {
    const instances = new Map<unknown, unknown>([
        [
            FilesQuickAccessProviderDIToken,
            new FilesQuickAccessProvider(deps.fileSearch, deps.commands, deps.gotoSource),
        ],
        [
            CommandsQuickAccessProviderDIToken,
            new CommandsQuickAccessProvider(deps.commands, deps.keybindings, deps.contextKeys),
        ],
        [GotoLineQuickAccessProviderDIToken, new GotoLineQuickAccessProvider(deps.gotoSource)],
    ]);
    const accessor: ServiceAccessor = {
        get: (diToken) => instances.get(diToken) as never,
    };
    return new QuickAccessRegistry(accessor, QUICK_ACCESS_PROVIDERS);
}

/** Мутабельный источник активного редактора: тесты подменяют getActiveEditor по ходу. */
interface MutableGotoLineSource extends IGotoLineEditorSource {
    getActiveEditor: () => IGotoLineEditor | null;
}

function createService(fileResults: FileSearchResult[] = []): {
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
} {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const fileSearch = makeFileSearchStub(fileResults);
    const component = makeComponent();
    const gotoSource: MutableGotoLineSource = { getActiveEditor: () => null };
    const service = new QuickOpenService(
        makeQuickAccessRegistry({ fileSearch, commands, keybindings, contextKeys, gotoSource }),
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
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

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
        // setVisible should not be called again (already visible, just focuses)
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

        // A mousedown whose target is the body (outside the QuickPick widget) closes it.
        // The press is NOT consumed, so it still passes through to whatever sits below —
        // matching VS Code's quick-pick dismissal behaviour.
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
        // Subscribe a marker so we can prove close() short-circuits before touching it.
        fileSearch.onIndexChanged = () => undefined;
        service.close();
        // Early return: the index subscription is left untouched.
        expect(fileSearch.onIndexChanged).not.toBeNull();
    });

    it("close() restores focus to previously focused element", () => {
        const { service, body, testApp } = createService();
        // Put something focusable in the body and focus it first
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

    it("open('files') calls search with empty query", () => {
        const { service, fileSearch } = createService();
        service.show();
        expect(fileSearch.search).toHaveBeenCalledWith("", 50);
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

        // Simulate the background walk publishing more entries.
        fileSearch.onIndexChanged?.();

        expect(fileSearch.search).toHaveBeenCalledWith("App", 50);
    });

    it("a late index-changed callback after close does not re-run the search", () => {
        const { service, fileSearch } = createService();
        service.show();
        // Capture the index-changed handler the controller installed.
        const handler = fileSearch.onIndexChanged;
        expect(handler).not.toBeNull();

        service.close();
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

        // Fire the captured callback after the session is closed: handleIndexChanged
        // must bail out (session not open) and not query the index.
        handler?.();
        expect(fileSearch.search).not.toHaveBeenCalled();
    });

    it("switching to command mode stops live file refreshes", () => {
        const { service, fileSearch, view } = createService();
        service.show();
        view.onQueryChange?.(">cmd"); // now in command mode
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();

        fileSearch.onIndexChanged?.();

        expect(fileSearch.search).not.toHaveBeenCalled();
    });

    it("close() unsubscribes from index changes", () => {
        const { service, fileSearch } = createService();
        service.show();
        expect(fileSearch.onIndexChanged).not.toBeNull();
        service.close();
        expect(fileSearch.onIndexChanged).toBeNull();
    });

    it("a background index refresh preserves the cursor mid-navigation", () => {
        // Reproduces the huge-monorepo bug: while the index streams in, the list
        // is re-published every ~50ms; the cursor must stay where the user put it.
        const results = [
            makeSearchResult("src/a.ts"),
            makeSearchResult("src/b.ts"),
            makeSearchResult("src/c.ts"),
            makeSearchResult("src/d.ts"),
        ];
        const { service, testApp, fileSearch, view } = createService(results);
        service.show();

        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        expect(view.selectedIndex).toBe(2);

        // Background walk publishes more entries → onIndexChanged fires.
        fileSearch.onIndexChanged?.();

        // Cursor preserved (previously it snapped back to 0).
        expect(view.selectedIndex).toBe(2);
        expect(view.items[2].label).toBe("c.ts");
    });

    it("a query change resets the cursor to the top", () => {
        const results = [makeSearchResult("src/a.ts"), makeSearchResult("src/b.ts"), makeSearchResult("src/c.ts")];
        const { service, testApp, view } = createService(results);
        service.show();

        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        expect(view.selectedIndex).toBe(2);

        // Typing a new query is a real query change → selection resets.
        view.onQueryChange?.("a");
        expect(view.selectedIndex).toBe(0);
    });

    it("items show basename as label and directory as description", () => {
        const results = [makeSearchResult("src/Controls/AppContainer.ts")];
        const { service, view } = createService(results);
        service.show();
        const items = view.items;
        expect(items[0].label).toBe("AppContainer.ts");
        expect(items[0].description).toBe("src/Controls");
    });

    it("file in root directory has empty description", () => {
        const results = [makeSearchResult("README.md")];
        const { service, view } = createService(results);
        service.show();
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
        service.show();
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
        service.show();
        const item = view.items[0];
        expect(item.descriptionMatchRanges).toEqual([[0, 3]]);
        // Nothing matched inside the basename.
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
        service.show();
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
        service.show();
        const item = view.items[0];
        expect(item.descriptionMatchRanges).toEqual([[2, 4]]);
        expect(item.labelMatchRanges).toEqual([[0, 2]]);
    });

    it("onAccept calls onExecuteCommand with workbench.openFile and absolutePath", async () => {
        const results = [makeSearchResult("src/main.ts", [])];
        const { service, commands, view } = createService(results);
        const execSpy = vi.spyOn(commands, "execute");
        service.show();

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

        // A bare item carrying no routing metadata (no commandId, no absolutePath).
        const bareItem: QuickPickItem = { label: "orphan" };
        view.onAccept?.(bareItem, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });

        // Neither branch fires: no command executed, picker stays open.
        expect(execSpy).not.toHaveBeenCalled();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("accepting file closes the picker", async () => {
        const results = [makeSearchResult("src/main.ts")];
        const { service, commands, body, view } = createService(results);
        service.show();
        const item = view.items[0];
        view.onAccept?.(item, 0);
        await new Promise<void>((r) => {
            queueMicrotask(r);
        });
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
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
        // No attachHost() → the component has no host body and no overlay session.
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
            }),
            component,
        );

        // open() reaches updatePosition, which must early-return without throwing
        // because there is no host body to measure against.
        expect(() => {
            svc.show();
        }).not.toThrow();
        // preferredWidth keeps its default since positioning was skipped (no recompute).
        expect(component.view.preferredWidth).toBe(60);
        // Без сессии компонент считается закрытым; live-обновления индекса не запрашивают поиск.
        expect(component.isOpen()).toBe(false);
        (fileSearch.search as ReturnType<typeof vi.fn>).mockClear();
        fileSearch.onIndexChanged?.();
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

            view.onQueryChange?.("A"); // leading → runs now
            view.onQueryChange?.("Ap"); // within cooldown → pending
            view.onQueryChange?.("App"); // within cooldown → replaces pending

            // Only the leading run has happened so far.
            expect(fileSearch.search).toHaveBeenCalledTimes(1);
            expect(fileSearch.search).toHaveBeenLastCalledWith("A", 50);

            vi.runAllTimers(); // trailing fires with the latest query

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

            view.onQueryChange?.("App"); // leading only
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

            view.onQueryChange?.("A"); // leading
            view.onQueryChange?.("Ap"); // pending
            service.close();

            vi.runAllTimers();

            // Only the leading run; the trailing one was cancelled on close.
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

            view.onQueryChange?.("A"); // file leading
            view.onQueryChange?.("Ap"); // file pending
            view.onQueryChange?.(">cmd"); // command mode → sync, cancels pending

            vi.runAllTimers();

            // The pending file trailing run was dropped; only the leading file run ran.
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
