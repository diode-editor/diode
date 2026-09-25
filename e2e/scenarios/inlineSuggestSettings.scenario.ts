import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Настройки призрачных подсказок: ручной режим и горячая клавиша.
//
// В settings.json сценария стоит `"editor.inlineSuggest.enabled": false` —
// автозапрос выключен. Печатаем `function fib` и ждём заведомо дольше и
// дебаунса, и задержки ответа демо-провайдера: призрака нет, строка ровно та,
// что набрана (кадр `manual-quiet`). Жмём **Alt+\** (команда
// `editor.action.inlineSuggest.trigger`) — та же позиция, тот же провайдер, и
// призрак появляется (кадр `manual-triggered`). То есть молчал гейт настройки,
// а не провайдер: `enabled` гейтит ТОЛЬКО автозапрос, как в VS Code.
//
// Демо-провайдер — фикстурное расширение `inline-ghost`; его задержка ответа
// берётся из `inlineGhost.responseDelay`, а каждый запрос он пишет в канал
// OUTPUT «Inline Ghost» (по нему видно, что при наборе его не дёргали).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

export default defineScenario({
    name: "inline-suggest-settings",
    title: "Manual inline suggestions: editor.inlineSuggest.enabled=false + Alt+\\",
    seedUserData: userData,
    settings: {
        "editor.inlineSuggest.enabled": false,
        // Быстрый ответ: сценарию важен гейт, а не медлительность провайдера.
        "inlineGhost.responseDelay": 50,
    },
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как
    // inline-completion — субпроцесс расширений на Windows флейкает).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Fibonacci demo"));

        // Новая строка под комментарием; набираем триггер демо-провайдера.
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendText("function fib");

        // Расширение активируется асинхронно — сначала убеждаемся, что провайдер
        // уже жив (контрольный Alt+\ приводит призрака), и только потом
        // показываем тишину при наборе. Иначе «призрака нет» было бы
        // неотличимо от «расширение ещё не поднялось».
        let ready = false;
        for (let attempt = 0; attempt < 15 && !ready; attempt++) {
            await editor.sendKey("Alt+\\");
            try {
                await editor.waitForText((t) => t.includes("return fibonacci(n - 1)"), { timeoutMs: 2000 });
                ready = true;
            } catch {
                // провайдер ещё не зарегистрирован — пробуем ещё раз
            }
        }
        if (!ready) throw new Error("inline-suggest-settings: Alt+\\ не показал призрака за 15 попыток");

        // Гасим призрака и набираем ДРУГОЙ триггер: при выключенном автозапросе
        // подсказка не приходит сама даже через несколько секунд.
        await editor.sendKey("Escape");
        await editor.sendKey("Enter");
        await editor.sendText("const greeting");
        await new Promise((r) => setTimeout(r, 3000));
        const quietText = frameToText(await editor.captureFrame());
        if (quietText.includes("Hello from ghost text!")) {
            throw new Error("inline-suggest-settings: призрак пришёл сам при enabled:false");
        }
        await editor.capture("manual-quiet");

        // Та же каретка, тот же провайдер — но по явной команде. Появился серый
        // хвост ` = "Hello from ghost text!";`.
        await editor.sendKey("Alt+\\");
        await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 5000 });
        await editor.capture("manual-triggered");

        // Tab принимает подсказку: серый текст стал настоящим (каретка уехала
        // в конец вставки — статус-бар показывает колонку за строкой).
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Col 43"), { timeoutMs: 5000 });
        await editor.capture("accepted");
    },
});
