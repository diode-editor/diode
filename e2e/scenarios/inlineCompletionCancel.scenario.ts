import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Канал OUTPUT фикстуры `inline-ghost` пишет строку на событие (`#<n> старт`/`отменён`/`ответ <k> пунктов`/
// `B опрошен`): у всех запросов, кроме последнего, есть `отменён`, и до второго провайдера отменённый не доезжает.
// Файл — plaintext без латиницы намеренно: попапу по словам не из чего открыться, иначе он перебивал бы призрака
// (при открытом попапе ядро подсказку не запрашивает).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-cancel-sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

/** Триггер фикстуры — одно слово: своё же слово в кандидаты попапа не идёт. */
const TRIGGER = "greeting";

/** Пауза между символами — темп обычного набора (ответ провайдера дольше). */
const TYPING_PAUSE_MS = 120;

const sleep = (ms: number): Promise<void> => new Promise<void>((done) => setTimeout(done, ms));

export default defineScenario({
    name: "inline-completion-cancel",
    title: "Inline completions: stale provider requests are cancelled (OUTPUT log)",
    seedUserData: userData,
    settings: {
        // Иначе запрос договорит раньше следующего символа, и отменять будет нечего.
        "inlineGhost.responseDelay": 900,
        // Quick suggest ждёт призрака не дольше 750 мс (как `_waitForInlineCompletionsAndTrigger` эталона) — 900 мс не влезают.
        "editor.quickSuggestions": "off",
    },
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    // Канал — user-биндом: палитра уводит фокус. F/E/S/V/G/H — мнемоники меню-бара, O — префикс SS3
    // (`ESC O P` = F1), поэтому J.
    userKeybindings: [
        { key: "alt+j", command: "workbench.action.output.show.extensions.test.inline-ghost.inline-ghost" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Демо отмены"));

        await editor.sendKey("Ctrl+End");
        await editor.sendKey("End");
        await editor.sendKey("Enter");

        // Прогрев: запрос до регистрации провайдера (на холодном раннере — секунды) возвращает пусто; не дождались
        // призрака — стираем строку одной правкой и пробуем снова.
        let live = false;
        for (let attempt = 0; attempt < 10 && !live; attempt++) {
            await editor.sendText(TRIGGER);
            try {
                await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 3000 });
                live = true;
            } catch {
                await editor.sendKey("Home");
                await editor.sendKey("Shift+End");
                await editor.sendKey("Backspace");
            }
        }
        if (!live) throw new Error("inline-completion-cancel: призрак не появился за 10 попыток прогрева");

        // Даём прогревочному запросу договорить, чтобы в кадр попала цепочка самого набора, а не хвост прогрева.
        await editor.sendKey("Escape");
        await editor.sendKey("Home");
        await editor.sendKey("Shift+End");
        await editor.sendKey("Backspace");
        await sleep(1500);

        for (const char of TRIGGER) {
            await editor.sendKey(char);
            await sleep(TYPING_PAUSE_MS);
        }

        await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 15_000 });
        await editor.capture("ghost");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+H");
        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("Inline Ghost"));
        await editor.sendKey("Ctrl+End"); // хвост журнала — там последние запросы
        await editor.waitForText((t) => t.includes("отменён"), { timeoutMs: 10_000 });
        await editor.capture("cancelled");
    },
});
