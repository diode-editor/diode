import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../TestUtils/TestApp.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { LogService } from "../../platform/log/common/logService.ts";
import { ProductIconServiceDIToken } from "../../platform/theme/common/productIconService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";

function createApp(logService = new LogService()) {
    const { container, bindApp } = createTestContainer();
    container.bind(ILogServiceDIToken, () => logService);
    const workbench = container.get(WorkbenchComponentDIToken);
    workbench.mount();
    const testApp = TestApp.create(workbench.view, new Size(100, 30));
    bindApp(testApp.app);
    const check = container.get(ProductIconServiceDIToken).codicon("check");
    return { testApp, commands: container.get(CommandRegistryDIToken), logService, check };
}

const flush = (): Promise<void> =>
    new Promise((r) => {
        queueMicrotask(r);
    });

/** The picker rows from Trace down to Off, as the screen shows them. */
function pickerRows(screen: string): string[] {
    const lines = screen.split("\n");
    const first = lines.findIndex((line) => /\bTrace\b/.test(line));
    return lines.slice(first, first + 6).map((line) => line.replace(/[│|]/g, "").replace(/\s+/g, " ").trim());
}

describe("Developer: Set Log Level...", () => {
    it("is in the command palette under upstream's id and title", () => {
        const { commands } = createApp();
        expect(commands.listCommands().find((c) => c.id === "workbench.action.setLogLevel")?.title).toBe(
            "Developer: Set Log Level...",
        );
    });

    it("shows the All section with Trace…Off; the current level is checked, Info is the default", () => {
        const { commands, testApp, check } = createApp();
        void commands.execute("workbench.action.setLogLevel");
        testApp.render();
        const screen = testApp.backend.screenToString();
        expect(screen).toContain("Set Log Level");
        expect(pickerRows(screen)).toEqual(["Trace All", "Debug", `${check} Info Default`, "Warning", "Error", "Off"]);
    });

    it("`--log debug` checks Debug", () => {
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Debug);
        const { commands, testApp, check } = createApp(logService);
        void commands.execute("workbench.action.setLogLevel");
        testApp.render();
        const rows = pickerRows(testApp.backend.screenToString());
        expect(rows[1]).toBe(`${check} Debug`);
        expect(rows[2]).toBe("Info Default");
    });

    it("the pick sets every channel's level, as `--log <level>`, and the window level extensions see", async () => {
        const { commands, testApp, logService } = createApp();
        const changes: LogLevel[] = [];
        logService.onDidChangeWindowLevel((level) => changes.push(level));
        void commands.execute("workbench.action.setLogLevel");
        // Trace → Debug → Info → Warning.
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("Enter");
        await flush();
        expect(logService.getWindowLevel()).toBe(LogLevel.Warn);
        expect(logService.getLevel("extensions.host")).toBe(LogLevel.Warn);
        expect(changes).toEqual([LogLevel.Warn]);
        testApp.render();
        expect(testApp.backend.screenToString()).not.toContain("Set Log Level");
    });

    it("the first row picks Trace; Escape changes nothing", async () => {
        const { commands, testApp, logService } = createApp();
        const cancelled = commands.execute("workbench.action.setLogLevel");
        testApp.sendKey("Escape");
        // A cancelled pick finishes the command quietly, not with an error in the Commands log.
        await expect(cancelled).resolves.toBeUndefined();
        expect(logService.getWindowLevel()).toBe(LogLevel.Info);
        expect(logService.getLevel("any")).toBe(LogLevel.Trace);

        void commands.execute("workbench.action.setLogLevel");
        testApp.sendKey("Enter");
        await flush();
        expect(logService.getWindowLevel()).toBe(LogLevel.Trace);
    });
});
