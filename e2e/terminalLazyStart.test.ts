import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Встроенный терминал на SEA-бинаре, открытый сразу после старта.
 *
 * VT-эмулятор (@xterm/headless) — ленивый кусок бандла `lazy/@xterm/headless.cjs`:
 * в `main.cjs` его нет, сессия терминала создаётся сразу, а эмулятор появляется,
 * когда кусок загрузился (`XtermSurface`). Здесь — гонка, которую юнит не
 * воспроизводит целиком: человек открыл несколько терминалов и печатает раньше,
 * чем редактор дозапустился и кусок загрузился. Вывод и ввод не теряются,
 * процесс жив. Заодно — кэш кода куска: V8 его принял (отказ ушёл бы в канал
 * Bootstrap как непредвиденная ошибка).
 */

// node-pty — только unix в нынешней упаковке (как сценарий `terminal`).
const describeUnix = process.platform === "win32" ? describe.skip : describe;

describeUnix("встроенный терминал сразу после старта — SEA", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("три терминала и набор команды до готовности редактора: вывод на экране, кэш кода принят", async () => {
        const { session } = await useHeadlessApp({
            files: { "a.txt": "hello\n" },
            open: ["a.txt"],
            env: { SHELL: "/bin/bash", PS1: "diode$ ", PROMPT_COMMAND: "" },
        });

        // Инспектор поднимается до активации расширений — команды уходят в ещё
        // не дозапустившийся редактор, без ожидания готовности и покоя рендера.
        await session.executeCommand("workbench.action.terminal.new");
        await session.executeCommand("workbench.action.terminal.new");
        await session.executeCommand("workbench.action.terminal.new");
        // Маркер разорван пустой подстановкой: целиком он может появиться только в
        // выводе шелла, а не в эхо набранной строки.
        await session.sendText('echo lazy""-term-$((6*7))');
        await session.sendKey("Enter");

        const frame = await session.waitForText((text) => text.includes("lazy-term-42"), { timeoutMs: 30_000 });
        expect(frameToText(frame)).toContain("TERMINAL");

        // Все три сессии живы: у каждой своя вкладка в списке терминалов.
        expect(await session.nodes("#terminalTabsList TextLabelElement")).toHaveLength(3);

        const bootstrap = await session.getOutput("bootstrap");
        expect(bootstrap).not.toContain("unexpected error");
        expect(bootstrap).not.toContain("unhandled rejection");
    }, 120_000);
});
