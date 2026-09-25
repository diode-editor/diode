import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Отмена устаревших запросов призрачной подсказки. Фикстурное расширение
// `inline-ghost` тянет с ответом 900 мс (`inlineGhost.responseDelay` в
// настройках сценария) и пишет в свой канал OUTPUT по строке
// на событие: `#<n> старт`, `#<n> отменён`, `#<n> ответ <k> пунктов`,
// `#<n> B опрошен` (второй провайдер). Набор в темпе живого человека рисует в
// канале цепочку: у всех запросов, кроме последнего, есть `отменён` — и до
// второго провайдера отменённый запрос не доезжает. До этой заявки в том же
// прогоне до `ответ` доживали ВСЕ запросы: провайдер получал вечно-живой
// токен, и работу никто не снимал.
//
// Файл — plaintext без латиницы намеренно: языкового сервера на нём нет, а
// попапу автодополнения по словам буфера не из чего открыться. Иначе попап
// перебивал бы призрака на каждом набранном символе (при открытом попапе ядро
// подсказку не запрашивает — люфт v1).

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
        // Провайдер тянет с ответом заметно для глаза: иначе запрос успевает
        // договорить раньше следующего символа, и отменять будет нечего.
        "inlineGhost.responseDelay": 900,
    },
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (субпроцесс
    // расширений на Windows флейкает — как settings-completion).
    skipOn: ["win32"],
    // Канал фикстуры — user-биндом, а не палитрой: палитра уводит фокус.
    // Буквы F/E/S/V/G/H заняты мнемониками меню-бара, а O — префикс SS3
    // (`ESC O P` = F1), поэтому J.
    userKeybindings: [{ key: "alt+j", command: "workbench.action.output.show.extensions.inline-ghost" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Демо отмены"));

        await editor.sendKey("Ctrl+End");
        await editor.sendKey("End");
        await editor.sendKey("Enter");

        // Прогрев: расширение активируется асинхронно (на холодном раннере —
        // секундами), и запрос, ушедший до регистрации провайдера, возвращает
        // пусто. Вставляем триггер целиком и ждём призрака; не дождались —
        // стираем строку одной правкой и пробуем снова (паттерн region-folding).
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

        // Чистим строку одной правкой и даём прогревочному запросу договорить,
        // чтобы в кадр попала цепочка самого набора, а не хвост прогрева.
        await editor.sendKey("Escape");
        await editor.sendKey("Home");
        await editor.sendKey("Shift+End");
        await editor.sendKey("Backspace");
        await sleep(1500);

        // Набор в темпе человека: каждый следующий символ делает предыдущий
        // запрос устаревшим — и тот отменяется, не дожидаясь ответа.
        for (const char of TRIGGER) {
            await editor.sendKey(char);
            await sleep(TYPING_PAUSE_MS);
        }

        // Дожил до ответа только последний запрос — за кареткой призрак.
        await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 15_000 });
        await editor.capture("ghost");

        // Журнал фикстуры: цепочка `старт`/`отменён` и один ответ в хвосте.
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
