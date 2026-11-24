import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import type { IExtension } from "../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../platform/extensions/common/iExtensionManifest.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { registerExtensionMenus } from "../services/extensions/common/extensionMenuContributor.ts";

// The `editor/title/run` contribution of the stock jbangdev.jbang-vscode 0.12.0, verbatim; its commands have PNG
// icons, which a terminal can't draw, so the button shows the submenu's own run glyph.
const JBANG: IExtensionContributions = {
    commands: [
        { command: "jbang.script.run", title: "Run JBang", category: "JBang", icon: "icons/jbang.png" },
        { command: "jbang.script.debug", title: "Debug JBang", category: "JBang", icon: "icons/debug-jbang.png" },
    ],
    menus: {
        "editor/title/run": [
            { command: "jbang.script.run", when: "isJBangFile", group: "1_jbangexecute@1" },
            {
                command: "jbang.script.debug",
                when: "resourceExtname == .java && isJBangFile",
                group: "1_jbangexecute@2",
            },
        ],
    },
} as IExtensionContributions;

const PLAY = ""; // codicon `play`, upstream `Codicon.run`
const ARROW = "▾";
const WIDTH = 80;

function extension(id: string, contributes: IExtensionContributions): IExtension {
    return { id, manifest: { name: id, publisher: "test", version: "0.0.1", contributes } } as unknown as IExtension;
}

function click(x: number, y: number, action: "press" | "release"): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("Workbench — Run or Debug split button (editor/title/run)", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let configuration: InMemoryConfigurationService;
    const harnesses: IAppHarness[] = [];
    const states: StateService[] = [];
    const runs: string[] = [];
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-title-run-", files: { "hello.java": "///usr/bin/env jbang\n" } });
        userData = createTempWorkspace({ prefix: "diode-title-run-user-" });
        runs.length = 0;
    });

    afterEach(() => {
        for (const harness of harnesses.splice(0)) harness.dispose();
        for (const state of states.splice(0)) state.dispose();
        ws.dispose();
        userData.dispose();
    });

    function boot(contributes: IExtensionContributions = JBANG): IAppHarness {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        states.push(state);
        configuration = createTestConfigurationService();
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("hello.java"),
            size: new Size(WIDTH, 16),
            stateService: state,
            configurationService: configuration,
        });
        harnesses.push(h);
        for (const command of contributes.commands ?? []) {
            h.commands.register(
                command.command,
                () => {
                    runs.push(command.command);
                },
                command.title,
            );
        }
        registerExtensionMenus([extension("jbangdev.jbang-vscode", contributes)], h.container.get(MenuRegistryDIToken));
        return h;
    }

    const keys = () => h.container.get(ContextKeyServiceDIToken);
    const flush = (): Promise<void> =>
        new Promise((resolve) => {
            queueMicrotask(resolve);
        });
    const screen = (): string[] => {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    };
    /** The tabs' label row (row 1 of the 3-row tab boxes): the title buttons sit on it too. */
    const labelY = (): number => {
        h.testApp.render();
        const strip = h.testApp.querySelector("EditorTabStripElement");
        expect(strip).not.toBeNull();
        return strip!.globalPosition.y + 1;
    };
    const tabRow = (): string => screen()[labelY()];
    const press = (x: number, y: number): void => {
        h.testApp.backend.simulateMouse(click(x, y, "press"));
        h.testApp.backend.simulateMouse(click(x, y, "release"));
    };
    const pickFromArrow = (label: string): void => {
        press(tabRow().indexOf(ARROW), labelY());
        const lines = screen();
        const y = lines.findIndex((line) => line.includes(label));
        expect(y).toBeGreaterThan(labelY());
        press(lines[y].indexOf(label), y);
    };

    it("is hidden while no item's when holds, then shows the run glyph and the arrow as one control", async () => {
        boot();
        await flush();
        expect(tabRow()).not.toContain(ARROW);

        keys().setRaw("isJBangFile", true);
        await flush();
        const row = tabRow();
        expect(row).toContain("hello.java");
        expect(row.trimEnd().endsWith(` ${PLAY} ${ARROW}`)).toBe(true);
    });

    it("the button runs the first visible item", async () => {
        boot();
        keys().setRaw("isJBangFile", true);
        await flush();
        press(tabRow().indexOf(PLAY), labelY());
        expect(runs).toStrictEqual(["jbang.script.run"]);
    });

    it("the arrow lists every visible item; the picked one runs and becomes the button", async () => {
        boot();
        keys().setRaw("isJBangFile", true);
        await flush();
        press(tabRow().indexOf(ARROW), labelY());
        const popup = screen().join("\n");
        expect(popup).toContain("Run JBang");
        expect(popup).toContain("Debug JBang");
        h.testApp.sendKey("Escape");

        pickFromArrow("Debug JBang");
        expect(runs).toStrictEqual(["jbang.script.debug"]);

        press(tabRow().indexOf(PLAY), labelY());
        expect(runs).toStrictEqual(["jbang.script.debug", "jbang.script.debug"]);
    });

    it("the pick is remembered per workspace across a restart", async () => {
        boot();
        keys().setRaw("isJBangFile", true);
        await flush();
        pickFromArrow("Debug JBang");
        // Upstream's storage key in the workspace scope: what VS Code calls `EditorTitleRun_lastActionId`.
        const stored: string | undefined = states[0].get<string | undefined>({
            key: "EditorTitleRun_lastActionId",
            scope: "workspace",
            default: undefined,
        });
        expect(stored).toBe("jbang.script.debug");
        states[0].flushSync();

        harnesses.splice(0).forEach((harness) => {
            harness.dispose();
        });
        boot();
        keys().setRaw("isJBangFile", true);
        await flush();
        runs.length = 0;
        press(tabRow().indexOf(PLAY), labelY());
        expect(runs).toStrictEqual(["jbang.script.debug"]);
    });

    it("a remembered item that is hidden now gives way to the first visible one", async () => {
        boot();
        keys().setRaw("isJBangFile", true);
        await flush();
        pickFromArrow("Debug JBang");

        // A JBang script that is not a `.java` file: Debug JBang's when is false.
        keys().setRaw("resourceExtname", ".kt");
        await flush();
        runs.length = 0;
        press(tabRow().indexOf(PLAY), labelY());
        expect(runs).toStrictEqual(["jbang.script.run"]);
    });

    it("a pick redraws the button with the picked item's icon at once, with no context change", async () => {
        boot({
            commands: [
                { command: "demo.run", title: "Run Demo", icon: "$(debug-start)" },
                { command: "demo.debug", title: "Debug Demo", icon: "$(debug-alt)" },
            ],
            menus: { "editor/title/run": [{ command: "demo.run" }, { command: "demo.debug" }] },
        } as IExtensionContributions);
        await flush();
        expect(tabRow()).toContain("");

        pickFromArrow("Debug Demo");
        expect(runs).toStrictEqual(["demo.debug"]);
        const row = tabRow();
        expect(row.trimEnd().endsWith(` ${ARROW}`)).toBe(true);
        expect(row).not.toContain("");
    });

    it("an item with a drawable icon lends it to the button", async () => {
        boot({
            commands: [{ command: "demo.run", title: "Run Demo", icon: "$(debug-start)" }],
            menus: { "editor/title/run": [{ command: "demo.run" }] },
        } as IExtensionContributions);
        await flush();
        const row = tabRow();
        expect(row.trimEnd().endsWith(` ${ARROW}`)).toBe(true);
        expect(row).not.toContain(PLAY);
    });

    it("sits left of the other editor title buttons (navigation, order -1)", async () => {
        boot();
        h.commands.register("demo.accept", () => undefined, "Accept");
        h.container.get(MenuRegistryDIToken).appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.accept",
            group: "navigation",
            icon: "✓",
        });
        keys().setRaw("isJBangFile", true);
        await flush();
        expect(tabRow().trimEnd().endsWith(` ${PLAY} ${ARROW} │ ✓`)).toBe(true);
    });
});
