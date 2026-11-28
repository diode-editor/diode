import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { SubprocessRpc } from "../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireProvideFileDecorations } from "../../../api/common/wireTypes.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { IDecorationData } from "../../../services/decorations/common/decorations.ts";
import { DecorationsService } from "../../../services/decorations/common/decorationsService.ts";
import { FileDecorationsCustomer } from "../../../services/extensions/node/customers/fileDecorationsCustomer.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { ExplorerComponent } from "./explorerComponent.ts";
import { ExplorerService } from "./explorerService.ts";

const THEME = WorkbenchTheme.fromThemeFile(darkPlusTheme);
const RED = THEME.getColor("charts.red");

/** A pull-only provider (no change event), as `vscjava.vscode-maven`: the explorer asks it about the rows it shows. */
function pullProvider(answer: (uri: Uri) => IDecorationData | undefined) {
    const asked: string[] = [];
    return {
        asked,
        provider: {
            label: "pull",
            onDidChange: Event.None,
            provideDecorations: (uri: Uri) => {
                asked.push(uri.toString());
                return Promise.resolve(answer(uri));
            },
        },
    };
}

const PULLED: IDecorationData = { letter: "P", tooltip: "pulled", color: "charts.red", bubble: true };

describe("ExplorerComponent — decorations by request", () => {
    let ws: ITempWorkspace;
    let service: ExplorerService;
    let component: ExplorerComponent;
    let decorations: DecorationsService;
    let app: TestApp;

    function setup(files: Record<string, string>, height = 12): void {
        ws = createTempWorkspace({ prefix: "diode-explorer-pull-", files });
        const config = createTestConfigurationService();
        const clipboard = new InMemoryFileClipboard();
        decorations = new DecorationsService();
        service = new ExplorerService(
            clipboard,
            config,
            diskFileService(),
            NULL_TREE_FILE_WATCHER,
            NERD_FONT_ICONS,
            decorations,
            new ThemeService(THEME),
        );
        const commands = new CommandRegistry();
        component = new ExplorerComponent(
            service,
            commands,
            clipboard,
            new ContextMenuService(
                new MenuService(
                    new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), MENU_CONTRIBUTIONS),
                ),
            ),
            makeViewsHarness().service,
            config,
            new WorkspaceContextService(),
        );
        service.setRootPath(ws.dir);
        app = TestApp.createWithContent(component.view, new Size(40, height));
    }

    afterEach(() => {
        component.dispose();
        service.dispose();
        decorations.dispose();
        ws.dispose();
    });

    function rows(): string[] {
        app.render();
        return app.backend
            .screenToString()
            .split("\n")
            .map((row) => row.trimEnd());
    }

    function rowOf(text: string): { y: number; row: string } {
        const all = rows();
        const y = all.findIndex((row) => new RegExp(`(^|\\s)${text}(\\s|$)`).test(row));
        expect(y, `row "${text}" in frame:\n${all.join("\n")}`).toBeGreaterThanOrEqual(0);
        return { y, row: all[y] };
    }

    function badgeOf(text: string): string {
        const { row } = rowOf(text);
        return row.slice(row.indexOf(text) + text.length).trim();
    }

    function labelFg(text: string): number | undefined {
        const { y, row } = rowOf(text);
        return app.backend.getFgAt(new Point(row.indexOf(text), y));
    }

    it("a provider without an event: the shown file gets its badge and color, the collapsed ancestors '●'", async () => {
        setup({ "src/deep/a.pull": "", "src/deep/b.txt": "", "src/main.ts": "", "README.md": "" });
        const pull = pullProvider((uri) => (uri.path.endsWith(".pull") ? PULLED : undefined));
        decorations.registerDecorationsProvider(pull.provider);
        await service.refresh();
        await vi.waitFor(() => {
            expect(pull.asked).toContain(Uri.file(ws.path("src")).toString());
        });
        expect(badgeOf("src")).toBe("");

        // Reveal expands src and deep; nothing else is done: the answer draws itself.
        await service.revealPath(ws.path("src/deep/b.txt"));
        await vi.waitFor(() => {
            expect(badgeOf("a.pull")).toBe("P");
        });
        expect(labelFg("a.pull")).toBe(RED);
        expect(badgeOf("deep")).toBe("●");
        expect(badgeOf("src")).toBe("●");
        expect(labelFg("src")).toBe(RED);
        expect(badgeOf("b.txt")).toBe("");
        expect(badgeOf("README.md")).toBe("");
        // The cursor stays where reveal put it.
        expect(service.getSelectedFilePath()).toBe(ws.path("src/deep/b.txt"));
    });

    it("a provider that throws doesn't stop the other one", async () => {
        setup({ "x.pull": "" });
        decorations.registerDecorationsProvider({
            label: "broken",
            onDidChange: Event.None,
            provideDecorations: () => Promise.reject(new Error("boom")),
        });
        decorations.registerDecorationsProvider(pullProvider(() => PULLED).provider);
        await service.refresh();
        await vi.waitFor(() => {
            expect(badgeOf("x.pull")).toBe("P");
        });
    });

    it("expanding a folder of 1000 files asks the provider in one batch; redrawing asks nothing", async () => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 1000; i++) files[`big/f${String(i).padStart(4, "0")}.ts`] = "";
        setup(files, 20);
        const [hostSide, extensionSide] = createInProcessChannelPair();
        const peer: SubprocessRpc = new RpcEndpoint(extensionSide);
        const batches: IWireProvideFileDecorations[] = [];
        peer.handleRequest("window.provideFileDecorations", (params) => {
            batches.push(params);
            return {};
        });
        const attached = new FileDecorationsCustomer(decorations).attach({
            rpc: new RpcEndpoint(hostSide),
            logger: undefined,
        });
        try {
            peer.notify("window.registerFileDecorationProvider", { handle: 1, extensionId: "ext.id" });
            await vi.waitFor(() => {
                expect(batches).toHaveLength(1); // the root's row
            });

            await service.revealPath(ws.path("big/f0000.ts"));
            await vi.waitFor(() => {
                expect(batches).toHaveLength(2);
            });
            expect(batches[1].requests).toHaveLength(1000);

            await service.refresh();
            await service.refresh();
            await new Promise((resolve) => setTimeout(resolve, 150));
            expect(batches).toHaveLength(2);
        } finally {
            attached.dispose();
        }
    });
});
