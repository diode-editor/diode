import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { ExtensionStatusBarAdapter } from "../../../api/browser/extensionStatusBarAdapter.ts";
import type { IOutputSink } from "../../../api/common/iExtensionWindowSinks.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

/**
 * Поверхность, без которой стоковое `Anthropic.claude-code` не активировалось
 * или падало в первой же фиче, — через НАСТОЯЩИЙ субпроцесс на синтетической
 * фикстуре (`claudeCodeSurface.cjs` трогает API так же, как бандл расширения).
 * Сам стоковый `.vsix` — в e2e-сценарии.
 */
async function makeHarness() {
    const bar = new StatusBarService(NULL_STATE_SERVICE);
    const output: { channel: string; level: string; value: string }[] = [];
    const outputSink: IOutputSink = {
        append: (channel, _label, level, value) => {
            output.push({ channel, level, value });
        },
        show: () => undefined,
    };
    const harness = await createExtensionTestHarness({
        extensions: [extensionFixture("test.claude", "claudeCodeSurface.cjs")],
        environment: { machineId: () => "f00d", defaultShell: () => "/usr/bin/fish" },
        statusBarItemSink: new ExtensionStatusBarAdapter(bar, {
            execute: () => Promise.resolve(undefined),
            registerProxy: () => ({ dispose: () => undefined }),
        }),
        outputSink,
    });
    return { bar, output, harness };
}

describe("ExtensionHost — поверхность Claude Code (subprocess)", () => {
    it("модуль с `NotebookCellOutputItem` на верхнем уровне грузится; env хоста виден уже в activate()", async () => {
        const { harness } = await makeHarness();
        try {
            expect(await harness.commandRegistry.execute("test.claude.atActivate")).toEqual({
                machineId: "f00d",
                shell: "/usr/bin/fish",
                errorMime: "application/vnd.code.notebook.error",
            });
        } finally {
            await harness.dispose();
        }
    });

    it("setStatusBarMessage доезжает до полосы и снимается по таймауту", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await harness.commandRegistry.execute("test.claude.setStatusBarMessage", "Claude Code: no change", 200);
            await vi.waitFor(() => {
                expect(bar.entries().some((e) => e.text === "Claude Code: no change")).toBe(true);
            });
            expect(bar.entries().find((e) => e.text === "Claude Code: no change")).toMatchObject({
                alignment: "left",
                name: "Extension Status",
            });
            await vi.waitFor(() => {
                expect(bar.entries().every((e) => e.text !== "Claude Code: no change")).toBe(true);
            });
        } finally {
            await harness.dispose();
        }
    });

    it("setStatusBarMessage без таймаута живёт до dispose расширения", async () => {
        const { bar, harness } = await makeHarness();
        try {
            await harness.commandRegistry.execute("test.claude.setStatusBarMessage", "sticky");
            await vi.waitFor(() => {
                expect(bar.entries().some((e) => e.text === "sticky")).toBe(true);
            });
            await harness.commandRegistry.execute("test.claude.clearStatusBarMessage");
            await vi.waitFor(() => {
                expect(bar.entries().every((e) => e.text !== "sticky")).toBe(true);
            });
        } finally {
            await harness.dispose();
        }
    });

    it("тред комментариев создаётся и правится; человеку — одна строка в Output", async () => {
        const { output, harness } = await makeHarness();
        try {
            const thread = await harness.commandRegistry.execute("test.claude.commentThread", "file:///a.ts");
            await harness.commandRegistry.execute("test.claude.commentThread", "file:///b.ts");
            expect(thread).toEqual({
                uri: "file:///a.ts",
                line: 3,
                canReply: false,
                state: 1,
                collapsibleState: 1,
            });
            await settle();
            expect(output).toEqual([
                {
                    channel: "extensions",
                    level: "warn",
                    value: expect.stringMatching(
                        /^комментарии "claude-code-hunks" в TUI пока не рисуются/,
                    ) as unknown as string,
                },
            ]);
        } finally {
            await harness.dispose();
        }
    });

    it("у терминала нет shell integration — расширение уходит в фоллбэк sendText", async () => {
        const { harness } = await makeHarness();
        try {
            expect(await harness.commandRegistry.execute("test.claude.terminalShellIntegration")).toEqual({
                shellIntegration: "undefined",
            });
        } finally {
            await harness.dispose();
        }
    });
});
