import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import type { DiodeSession } from "./helpers/runDiode.ts";
import { usePtyApp } from "./helpers/useApp.ts";

/**
 * Запросы к хост-терминалу (`terminal.integrated.colorSource: "host"` — OSC 10/11/4
 * и DA1-«часовой») на SEA-бинаре в настоящем PTY.
 *
 * Ответ терминала приходит во ввод tty. Пока tty в cooked-режиме с ECHO (до
 * `backend.setup()`), ядро печатает его на основной экран как `^[]10;rgb:…`, и
 * после выхода из alt-screen этот мусор оставался в шелле (v0.9.0: зонд цветов
 * уходил из конструктора сервиса, до `app.run()`). Тест играет роль терминала:
 * отвечает на запросы и проверяет, что запросы уходят только после входа в
 * alt-screen (за ним в `setup()` сразу raw-режим) и что эха ответов в выводе нет.
 */

// node-pty — только unix в нынешней упаковке (как сценарий `terminal`).
const describeUnix = process.platform === "win32" ? describe.skip : describe;

const ALT_SCREEN_ON = "\x1b[?1049h";
const ST = "\x1b\\";
const DA1_QUERY = "\x1b[c";
const HOST_BG_QUERY = `\x1b]11;?${ST}`;
/** OSC 10/11 (текст/фон), OSC 4;n (палитра) и DA1. */
const QUERY = /\x1b\](10|11);\?\x1b\\|\x1b\]4;(\d+);\?\x1b\\|\x1b\[c/g;

/** Отвечает на запросы цветов и DA1, как настоящий терминал, пока сессия жива. */
function answerTerminalQueries(session: DiodeSession): () => void {
    // Всё до `scanned` разобрано; хвост короче самого длинного запроса держим —
    // запрос мог оборваться на границе чанка и дочитается на следующем тике.
    let scanned = 0;
    const timer = setInterval(() => {
        const output = session.getRawOutput();
        const replies: string[] = [];
        let end = scanned;
        for (const match of output.slice(scanned).matchAll(QUERY)) {
            if (match[0] === DA1_QUERY) replies.push("\x1b[?62;52;c");
            else if (match[2] === undefined) replies.push(`\x1b]${match[1]};rgb:1e1e/1e1e/2e2e${ST}`);
            else replies.push(`\x1b]4;${match[2]};rgb:4545/4747/5a5a${ST}`);
            end = scanned + match.index + match[0].length;
        }
        scanned = Math.max(end, output.length - 16);
        if (replies.length > 0) session.write(replies.join(""));
    }, 2);
    return () => {
        clearInterval(timer);
    };
}

describeUnix("запросы к хост-терминалу — SEA", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("colorSource=host: запросы уходят после входа в raw-режим, ответы не печатаются эхом", async () => {
        const { session } = await usePtyApp({
            files: { "a.txt": "hello\n" },
            open: ["a.txt"],
            settings: { "terminal.integrated.colorSource": "host" },
        });
        const stop = answerTerminalQueries(session);
        try {
            await session.waitFor((s) => s.findText("hello") !== null);
            await expect.poll(() => session.getRawOutput().includes(HOST_BG_QUERY), { timeout: 10_000 }).toBe(true);
            // Дать ответам дойти и (если бы tty был в cooked-режиме) отразиться эхом.
            await new Promise((resolve) => setTimeout(resolve, 300));
        } finally {
            stop();
        }
        const output = session.getRawOutput();
        // ECHOCTL печатает ESC как `^[`: так выглядел мусор в шелле после выхода.
        expect(output).not.toContain("^[");
        const altScreen = output.indexOf(ALT_SCREEN_ON);
        expect(altScreen).toBeGreaterThanOrEqual(0);
        expect(output.indexOf(HOST_BG_QUERY)).toBeGreaterThan(altScreen);
        expect(output.indexOf(DA1_QUERY)).toBeGreaterThan(altScreen);

        await session.dispose();
        expect(session.isExited).toBe(true);
    }, 120_000);
});
