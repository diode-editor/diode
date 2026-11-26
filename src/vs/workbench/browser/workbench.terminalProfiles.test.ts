import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { ProductIconServiceDIToken } from "../../platform/theme/common/productIconService.ts";
import { ExtensionTerminalAdapter } from "../contrib/terminal/browser/extensionTerminalAdapter.ts";
import { TerminalEditorServiceDIToken } from "../contrib/terminal/browser/terminalEditorService.ts";
import {
    type TerminalProfileService,
    TerminalProfileServiceDIToken,
} from "../contrib/terminal/browser/terminalProfileService.ts";
import {
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";
import { ExtensionPtySessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";
import { NotificationServiceDIToken } from "../services/notification/browser/notificationService.ts";

import { PanelServiceDIToken } from "./parts/panel/panelService.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";

const NEW_WITH_PROFILE = "workbench.action.terminal.newWithProfile";
const JS_DEBUG = "ms-vscode.js-debug";
const DEBUG_TERMINAL = "extension.js-debug.debugTerminal";

/**
 * The extension's side is played by the adapter, as the subprocess would: the provider answers with a pty terminal
 * at the location the host asked for (the RPC leg is covered by `terminalCustomer.profiles.test.ts`).
 */
describe("Workbench — Create New Terminal (With Profile)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let profiles: TerminalProfileService;
    /** Where the host asked the provider to put each terminal. */
    let targets: string[];

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-profiles-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: `${ws.dir}/alpha.txt`,
            focusEditor: true,
            configurationService: createTestConfigurationService(settings),
        });
        terminal = h.container.get(TerminalServiceDIToken);
        profiles = h.container.get(TerminalProfileServiceDIToken);
        const adapter = new ExtensionTerminalAdapter(
            terminal,
            h.container.get(ViewsServiceDIToken),
            h.container.get(ExtensionPtySessionFactoryDIToken),
            h.container.get(TerminalEditorServiceDIToken),
            h.container.get(IConfigurationServiceDIToken),
        );
        profiles.setContributedProfiles([
            { extensionIdentifier: JS_DEBUG, id: DEBUG_TERMINAL, title: "JavaScript Debug Terminal", icon: "$(debug)" },
            { extensionIdentifier: "test.other", id: "unanswered", title: "Another Profile", icon: "no-such-icon" },
            // A bare id, with a modifier: drawn as `$(sync~spin)` would be.
            { extensionIdentifier: "test.other", id: "spin", title: "Spinning Profile", icon: "sync~spin" },
        ]);
        let nextExtHostId = 1;
        targets = [];
        profiles.registerProvider(DEBUG_TERMINAL, (target) => {
            targets.push(target);
            adapter.create({
                extHostId: nextExtHostId++,
                pty: true,
                name: "JavaScript Debug Terminal",
                location: target === "editor" ? 2 : 1,
            });
            return Promise.resolve();
        });
    }

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };
    const pickerRow = (text: string): string | undefined =>
        screen()
            .split("\n")
            .find((line) => line.includes(text));

    it("lists the default shell under profiles, then the extensions' profiles by title under contributed", async () => {
        boot();
        const icons = h.container.get(ProductIconServiceDIToken);
        const run = h.commands.execute(NEW_WITH_PROFILE) as Promise<void>;
        const frame = screen();
        expect(frame).toContain("Select the terminal profile to create");
        const lines = frame.split("\n");
        const row = (text: string): number => lines.findIndex((line) => line.includes(text));
        expect(row(`${icons.codicon("terminal")} bash`)).toBeGreaterThan(-1);
        expect(pickerRow(" bash")).toContain("/bin/bash");
        expect(pickerRow(" bash")).toContain("profiles");
        // An icon that names no codicon falls back to the terminal one; the group label rides on the first row.
        expect(pickerRow("Another Profile")).toContain(`${icons.codicon("terminal")} Another Profile`);
        expect(pickerRow("Another Profile")).toContain("contributed");
        expect(pickerRow("JavaScript Debug Terminal")).toContain(`${icons.codicon("debug")} JavaScript Debug Terminal`);
        expect(pickerRow("JavaScript Debug Terminal")).not.toContain("contributed");
        expect(row(" bash")).toBeLessThan(row("Another Profile"));
        expect(row("Another Profile")).toBeLessThan(row("JavaScript Debug Terminal"));
        // The modifier is dropped, as wherever `$(name~spin)` is drawn.
        expect(pickerRow("Spinning Profile")).toContain(`${icons.codicon("sync")} Spinning Profile`);
        h.testApp.sendKey("Escape");
        await run;
        expect(terminal.getInstances()).toStrictEqual([]);
    });

    it("picking an extension's profile opens its terminal in the TERMINAL panel, active and focused", async () => {
        boot();
        const run = h.commands.execute(NEW_WITH_PROFILE) as Promise<void>;
        h.testApp.render();
        typeText(h.testApp, "JavaScript");
        h.testApp.sendKey("Enter");
        await run;
        // The command refreshes the keys itself: no render has happened since the terminal opened.
        expect(h.container.get(ContextKeyServiceDIToken).get("terminalCount")).toBe(1);
        expect(targets).toStrictEqual(["panel"]);
        expect(terminal.getInstances().map((instance) => instance.title)).toStrictEqual(["JavaScript Debug Terminal"]);
        expect(terminal.getActiveInstance()?.title).toBe("JavaScript Debug Terminal");
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(screen()).toContain("TERMINAL");
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("with terminal.integrated.defaultLocation = editor the profile's terminal opens as an editor tab", async () => {
        boot({ "terminal.integrated.defaultLocation": "editor" });
        const run = h.commands.execute(NEW_WITH_PROFILE) as Promise<void>;
        h.testApp.render();
        typeText(h.testApp, "JavaScript");
        h.testApp.sendKey("Enter");
        await run;
        expect(targets).toStrictEqual(["editor"]);
        expect(terminal.getInstances()).toStrictEqual([]);
        expect(terminal.getEditorInstances().map((instance) => instance.title)).toStrictEqual([
            "JavaScript Debug Terminal",
        ]);
        expect(screen()).toContain("JavaScript Debug Terminal");
        // The TERMINAL panel stays as it was: the terminal lives in the editor area.
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).not.toBe(TERMINAL_VIEW_ID);
    });

    it("picking the default shell is Create New Terminal", async () => {
        boot();
        const run = h.commands.execute(NEW_WITH_PROFILE) as Promise<void>;
        h.testApp.render();
        h.testApp.sendKey("Enter");
        await run;
        expect(terminal.getInstances().map((instance) => instance.title)).toStrictEqual(["bash"]);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("a profile no provider answers for is an error notification, and no terminal opens", async () => {
        boot();
        const run = h.commands.execute(NEW_WITH_PROFILE) as Promise<void>;
        h.testApp.render();
        typeText(h.testApp, "Another");
        h.testApp.sendKey("Enter");
        await run;
        // The toast wraps the message.
        expect(screen().replace(/\s*│\s*/gu, " ")).toMatch(
            /No terminal profile provider registered for id\s+"unanswered"/u,
        );
        // A toast with only the close button, not a modal dialog.
        const notifications = h.container.get(NotificationServiceDIToken);
        expect(notifications.current()).toBeNull();
        expect(notifications.passive()).toMatchObject([{ severity: "error", modal: false, items: [] }]);
        expect(terminal.getInstances()).toStrictEqual([]);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).not.toBe(TERMINAL_VIEW_ID);
    });
});
