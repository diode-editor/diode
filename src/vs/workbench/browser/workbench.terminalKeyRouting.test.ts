import type { HFlexElement } from "@tuidom/elements/layout/hFlexElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { type IUserKeybindingRule, UserKeybindingsDIToken } from "../../platform/keybinding/common/userKeybindings.ts";
import { type TerminalService, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";

import { statusTexts } from "./parts/statusbar/statusBarComponent.testUtils.ts";

const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";
const TOGGLE_SIDEBAR = "workbench.action.toggleSidebarVisibility";

/** #820: with the terminal focused the key is the shell's, the workbench keeps the skip set, chords and unencodable keys. */
describe("Workbench — keys in the focused terminal go to the shell, like VS Code", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let configuration: InMemoryConfigurationService;
    let terminal: TerminalService;
    let surface: FakeTerminalSurface;

    function boot(
        settings: Readonly<Record<string, unknown>> = {},
        where: "panel" | "editor" = "panel",
        keybindings: readonly IUserKeybindingRule[] = [],
    ): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-key-routing-", files: { "a.txt": "alpha\n" } });
        configuration = createTestConfigurationService(settings);
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: { width: 120, height: 30 },
            configurationService: configuration,
            containerOverrides: (container) => {
                container.bind(UserKeybindingsDIToken, () => keybindings);
            },
        });
        terminal = h.container.get(TerminalServiceDIToken);
        if (where === "panel") {
            h.commands.execute(TOGGLE_TERMINAL);
            surface = terminal.getActiveInstance()?.session as FakeTerminalSurface;
        } else {
            h.commands.execute("workbench.action.createTerminalEditor");
            surface = terminal.getEditorInstances()[0].session as FakeTerminalSurface;
        }
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        surface.writes.length = 0;
    }

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const sidebarVisible = (): boolean => h.workbench.workbenchLayout.getLeftPanelVisible();
    const menuOpen = (): boolean => h.testApp.querySelector("PopupMenuElement") !== null;
    const quickOpenShown = (): boolean => h.testApp.root.overlayLayer.hasVisibleItems();
    const terminalFocused = (): boolean => h.testApp.focusedElement instanceof TerminalViewElement;
    const hints = (): string[] => statusTexts(h.testApp.querySelector("#statusBar") as HFlexElement);

    describe("default settings: workbench shortcuts go to the shell", () => {
        it("Ctrl+B is ^B in the shell, the sidebar stays", () => {
            boot();
            const before = sidebarVisible();

            h.testApp.sendKey("Ctrl+B");

            expect(surface.writes).toEqual(["\x02"]);
            expect(sidebarVisible()).toBe(before);
            expect(terminalFocused()).toBe(true);
        });

        it.each([
            ["Ctrl+N", "\x0e"],
            ["Ctrl+O", "\x0f"],
            ["Ctrl+S", "\x13"],
            ["Ctrl+G", "\x07"],
            ["Ctrl+Q", "\x11"],
            ["Ctrl+\\", "\x1c"],
        ])("%s reaches the shell and the focus stays in the terminal", (key, bytes) => {
            boot();

            h.testApp.sendKey(key);

            expect(surface.writes).toEqual([bytes]);
            expect(terminalFocused()).toBe(true);
            expect(quickOpenShown()).toBe(false);
        });

        it("Alt+F is ESC f in the shell, the File menu stays closed", () => {
            boot();

            h.testApp.sendKey("Alt+f");

            expect(surface.writes).toEqual(["\x1bf"]);
            expect(menuOpen()).toBe(false);
        });

        it("Escape reaches the shell", () => {
            boot();

            h.testApp.sendKey("Escape");

            expect(surface.writes).toEqual(["\x1b"]);
        });

        it("Escape never starts a chord in the terminal, even when one is bound (`escape escape`)", () => {
            boot({}, "panel", [{ key: "escape escape", command: TOGGLE_SIDEBAR }]);
            const before = sidebarVisible();

            h.testApp.sendKey("Escape");
            h.testApp.sendKey("Escape");

            expect(surface.writes).toEqual(["\x1b", "\x1b"]);
            expect(sidebarVisible()).toBe(before);
        });

        it("a key for the shell clears the 'is not a command' hint of a broken chord", () => {
            boot();
            h.testApp.sendKey("Ctrl+K");
            h.testApp.sendKey("Ctrl+Y");
            expect(hints().some((text) => text.includes("is not a command"))).toBe(true);

            h.testApp.sendKey("a");

            expect(surface.writes).toEqual(["a"]);
            expect(hints().some((text) => text.includes("is not a command"))).toBe(false);
        });
    });

    describe("default settings: the workbench keeps its keys", () => {
        it("Ctrl+P (a skip-set command) opens Quick Open, nothing reaches the shell", () => {
            boot();

            h.testApp.sendKey("Ctrl+P");

            expect(quickOpenShown()).toBe(true);
            expect(surface.writes).toEqual([]);
        });

        it("Ctrl+K starts a chord instead of reaching the shell; Ctrl+K E shows the Explorer", () => {
            boot();
            h.commands.execute(TOGGLE_SIDEBAR);
            expect(sidebarVisible()).toBe(false);

            h.testApp.sendKey("Ctrl+K");
            expect(hints().some((text) => text.includes("Waiting for next key"))).toBe(true);
            h.testApp.sendKey("E");

            expect(sidebarVisible()).toBe(true);
            expect(surface.writes).toEqual([]);
        });

        it("a bound key with Meta stays with the workbench: Cmd+B (kitty Super) toggles the sidebar", () => {
            // Under tmux there is no Cmd (it shares a bit with Alt): pin the mode off, the test may run inside tmux.
            boot({ "keyboard.platform": "mac", "terminal.modes": { tmux: false } });
            const before = sidebarVisible();

            h.testApp.backend.sendRaw("\x1b[98;9u");

            expect(sidebarVisible()).toBe(!before);
            expect(surface.writes).toEqual([]);
        });

        it("an unbound key with Meta goes to the shell: Super+Y (kitty) is ESC y", () => {
            boot();

            h.testApp.backend.sendRaw("\x1b[121;9u");

            expect(surface.writes).toEqual(["\x1by"]);
        });

        // #856: the outer terminal's legacy bytes reach the shell as the same xterm.js encoding.
        it.each([
            ["Shift+Tab", "\x1b[Z"],
            ["Ctrl+Left", "\x1b[1;5D"],
            ["Shift+Up", "\x1b[1;2A"],
            ["Alt+Right", "\x1b[1;3C"],
            ["F2", "\x1bOQ"],
            ["Ctrl+Delete", "\x1b[3;5~"],
        ])("%s reaches the shell encoded like xterm.js", (_name, bytes) => {
            boot();

            h.testApp.backend.sendRaw(bytes);

            expect(surface.writes).toEqual([bytes]);
            expect(terminalFocused()).toBe(true);
        });

        it("Ctrl+, which the terminal can't encode, opens the settings", async () => {
            boot();

            h.testApp.sendKey("Ctrl+,");

            expect(surface.writes).toEqual([]);
            await vi.waitFor(() => {
                expect(terminalFocused()).toBe(false);
            });
        });
    });

    describe("settings", () => {
        it("commandsToSkipShell `-workbench.action.quickOpen` sends Ctrl+P to the shell", () => {
            boot({ "terminal.integrated.commandsToSkipShell": ["-workbench.action.quickOpen"] });

            h.testApp.sendKey("Ctrl+P");

            expect(surface.writes).toEqual(["\x10"]);
            expect(quickOpenShown()).toBe(false);
        });

        it("commandsToSkipShell with toggleSidebarVisibility gives Ctrl+B back to the workbench", () => {
            boot({ "terminal.integrated.commandsToSkipShell": [TOGGLE_SIDEBAR] });
            const before = sidebarVisible();

            h.testApp.sendKey("Ctrl+B");

            expect(sidebarVisible()).toBe(!before);
            expect(surface.writes).toEqual([]);
        });

        it("sendKeybindingsToShell sends even Ctrl+P to the shell", () => {
            boot({ "terminal.integrated.sendKeybindingsToShell": true });

            h.testApp.sendKey("Ctrl+P");

            expect(surface.writes).toEqual(["\x10"]);
            expect(quickOpenShown()).toBe(false);
        });

        it("sendKeybindingsToShell keeps chords: Ctrl+K still starts one", () => {
            boot({ "terminal.integrated.sendKeybindingsToShell": true });

            h.testApp.sendKey("Ctrl+K");

            expect(surface.writes).toEqual([]);
            expect(hints().some((text) => text.includes("Waiting for next key"))).toBe(true);
        });

        it("allowChords off sends Ctrl+K to the shell", () => {
            boot({ "terminal.integrated.allowChords": false });

            h.testApp.sendKey("Ctrl+K");

            expect(surface.writes).toEqual(["\x0b"]);
            expect(hints().some((text) => text.includes("Waiting for next key"))).toBe(false);
        });

        it("allowMnemonics opens the File menu on Alt+F", () => {
            boot({ "terminal.integrated.allowMnemonics": true });

            h.testApp.sendKey("Alt+f");

            expect(menuOpen()).toBe(true);
            expect(surface.writes).toEqual([]);
        });

        it("allowMnemonics does nothing with a Mac keyboard: Alt+F still reaches the shell, even when bound", () => {
            boot({ "terminal.integrated.allowMnemonics": true, "keyboard.platform": "mac" }, "panel", [
                { key: "alt+f", command: TOGGLE_SIDEBAR },
            ]);
            const before = sidebarVisible();

            h.testApp.sendKey("Alt+f");

            expect(surface.writes).toEqual(["\x1bf"]);
            expect(sidebarVisible()).toBe(before);
            expect(menuOpen()).toBe(false);
        });

        it("a changed setting applies to the next key, without restarting the terminal", async () => {
            boot();
            await configuration.updateValue("terminal.integrated.commandsToSkipShell", ["-workbench.action.quickOpen"]);

            h.testApp.sendKey("Ctrl+P");

            expect(surface.writes).toEqual(["\x10"]);

            await configuration.updateValue("terminal.integrated.allowMnemonics", true);
            h.testApp.sendKey("Alt+f");

            expect(menuOpen()).toBe(true);
        });
    });

    /** #857: a program switched on the kitty keyboard protocol (CSI > 1 u); the outer terminal speaks kitty too. */
    describe("kitty keyboard protocol in the terminal", () => {
        function bootKitty(flags: number): void {
            boot();
            surface.kittyKeyboardFlags = flags;
        }

        it.each([
            ["Shift+Enter", "\x1b[13;2u", "\x1b[13;2u"],
            ["Ctrl+I", "\x1b[105;5u", "\x1b[105;5u"],
            ["Ctrl+B", "\x1b[98;5u", "\x1b[98;5u"],
            ["Escape", "\x1b[27u", "\x1b[27u"],
            ["a", "a", "a"],
        ])("%s reaches the shell in the protocol's encoding", (_name, raw, bytes) => {
            bootKitty(1);

            h.testApp.backend.sendRaw(raw);

            expect(surface.writes).toEqual([bytes]);
            expect(terminalFocused()).toBe(true);
        });

        it.each([
            ["Ctrl+Shift+E", "\x1b[101;6u"],
            ["Ctrl+Shift+F", "\x1b[102;6u"],
            ["Ctrl+Shift+G", "\x1b[103;6u"],
        ])("%s (skip set) opens its view instead of reaching the shell", async (_name, raw) => {
            bootKitty(1);

            h.testApp.backend.sendRaw(raw);

            expect(surface.writes).toEqual([]);
            await vi.waitFor(() => {
                expect(terminalFocused()).toBe(false);
            });
        });

        it("Ctrl+Shift+P (skip set) opens the command palette instead of reaching the shell", () => {
            bootKitty(1);

            h.testApp.backend.sendRaw("\x1b[112;6u");

            expect(surface.writes).toEqual([]);
            expect(quickOpenShown()).toBe(true);
        });

        it("with flag 2 the shell gets the release from the outer terminal's keyup", () => {
            bootKitty(3);

            h.testApp.backend.sendRaw("\x1b[98;5u\x1b[98;5:3u");

            expect(surface.writes).toEqual(["\x1b[98;5u", "\x1b[98;5:3u"]);
        });

        // VS Code's key handler resolves the keyup like the keydown: a skip-set key or a chord never reaches xterm.js,
        // so the program never sees a release for a press it didn't get.
        it("with flag 2 the release of a skip-set key (Shift+PageUp scrolls) stays with the workbench too", () => {
            bootKitty(3);

            h.testApp.backend.sendRaw("\x1b[5;2~\x1b[5;2:3~");

            expect(surface.writes).toEqual([]);
            expect(terminalFocused()).toBe(true);
        });

        it("with flag 2 the release of Ctrl+K, which starts a chord, doesn't reach the shell", () => {
            bootKitty(3);

            h.testApp.backend.sendRaw("\x1b[107;5u\x1b[107;5:3u");

            expect(surface.writes).toEqual([]);
        });
    });

    describe("terminal in the editor area", () => {
        it("Ctrl+B reaches the shell", () => {
            boot({}, "editor");
            const before = sidebarVisible();

            h.testApp.sendKey("Ctrl+B");

            expect(surface.writes).toEqual(["\x02"]);
            expect(sidebarVisible()).toBe(before);
        });

        it("Ctrl+W (killEditor, in the skip set) closes the terminal editor", () => {
            boot({}, "editor");

            h.testApp.sendKey("Ctrl+W");

            expect(surface.writes).toEqual([]);
            expect(terminal.getEditorInstances()).toHaveLength(0);
        });
    });

    it("outside the terminal nothing changes: Ctrl+B in the text editor toggles the sidebar", () => {
        boot();
        h.workbench.focusEditor();
        const before = sidebarVisible();

        h.testApp.sendKey("Ctrl+B");

        expect(sidebarVisible()).toBe(!before);
        expect(surface.writes).toEqual([]);
    });
});
