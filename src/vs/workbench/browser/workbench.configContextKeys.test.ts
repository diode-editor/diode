import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { KeybindingRegistryDIToken, parseKeybinding } from "../../platform/keybinding/common/keybindingRegistry.ts";

// The binding shape of the stock Claude Code extension (`when: config.claudeCode.useTerminal`).
// F9 instead of Ctrl+Esc: the latter is distinguishable only in kitty/csi-u, and the point here is `when`.

describe("Workbench — when-ключи config.*", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let configuration: InMemoryConfigurationService;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("бинд с when: config.* срабатывает по настройке и гаснет, когда её выключили", async () => {
        ws = createTempWorkspace({ prefix: "diode-config-keys-", files: { "a.txt": "alpha\n" } });
        configuration = createTestConfigurationService({ "claudeCode.useTerminal": true });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            focusEditor: true,
            configurationService: configuration,
        });
        const runs: string[] = [];
        h.commands.register("demo.terminal.open.keyboard", () => {
            runs.push("open");
        });
        h.container
            .get(KeybindingRegistryDIToken)
            .register(
                parseKeybinding("f9"),
                "demo.terminal.open.keyboard",
                "config.claudeCode.useTerminal",
                "extension",
            );

        h.testApp.sendKey("F9");
        expect(runs).toStrictEqual(["open"]);

        await configuration.updateValue("claudeCode.useTerminal", false);
        h.testApp.sendKey("F9");
        expect(runs).toStrictEqual(["open"]);
    });
});
