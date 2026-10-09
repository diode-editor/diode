import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IOutputSink } from "../../../../workbench/api/common/iExtensionWindowSinks.ts";

/**
 * Расширение с деревом обязано активироваться ЦЕЛИКОМ. Дерево пока не
 * рисуется (Phase 8b), но без `vscode.TreeItem` модуль расширения падал ещё
 * при загрузке (`class Target extends vscode.TreeItem` на уровне модуля), а
 * без `window.registerTreeDataProvider` — второй строкой `activate()`. Оба
 * раза пользователь терял всё расширение: команды, задачи, провайдеры.
 */
describe("ExtensionHost — расширение с деревом активируется целиком", () => {
    it("модуль с `extends vscode.TreeItem` грузится, команда после регистрации дерева исполняется", async () => {
        const output: { channel: string; level: string; value: string }[] = [];
        const outputSink: IOutputSink = {
            append: (channel, _label, level, value) => {
                output.push({ channel, level, value });
            },
            show: () => undefined,
        };
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.treeOutline", "treeOutlineExtension.cjs")],
            outputSink,
        });
        try {
            await settle();
            expect(harness.host.hasExtension("test.treeOutline")).toBe(true);
            // Дефолт None (0) — эталонный; ThemeIcon доехал как значение.
            expect(await harness.commandRegistry.execute("test.treeTargets")).toEqual([
                "//app:main:0:play",
                "//lib:greeter:0:play",
            ]);
            // Человеку — одна строка, что дерева не будет.
            expect(output).toEqual([
                {
                    channel: "extensions",
                    level: "warn",
                    value: expect.stringMatching(/^дерево "test\.targets" в TUI пока не рисуется/) as unknown as string,
                },
            ]);
        } finally {
            await harness.dispose();
        }
    });
});
