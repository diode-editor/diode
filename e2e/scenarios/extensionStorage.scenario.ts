import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Каталоги хранения расширения + команда setContext. Фикстурное расширение
// `ext-storage-demo` в activate() пишет счётчик запусков в `globalStorageUri`
// (туда же AI-автодополнения кладут скачанный движок) и объявляет свой кейбинд
// `alt+q` под `when: "extStorageDemo.armed"`. Кадры показывают круг целиком:
// расширение поднялось и прочитало своё хранилище → клавиша мертва, пока ключ
// не выставлен → `Arm` её оживил → `Disarm` погасил снова → пути хранения
// напечатаны в канал Output.

// Markdown и без папки-воркспейса — как в status-bar-сценарии: иначе полосу
// делят сегменты SCM и спиннер tsserver, и её раскладка плывёт по ходу прогона.
// Побочный (и честный) эффект: `storageUri` при закрытой папке — `undefined`,
// ровно как в VS Code; это видно на последнем кадре.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-ext-storage-demo");

/** Исполняет команду расширения через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

/**
 * Нажимает Alt+Q и дожидается барьера: следом идёт ArrowDown, и мы ждём нового
 * `Ln`. Ввод обрабатывается по порядку, поэтому доехавший курсор означает, что
 * Alt+Q тоже уже обработан — иначе «ничего не произошло» было бы неотличимо от
 * «ещё не успело произойти».
 */
async function pressGateKey(editor: ScenarioDriver, line: number): Promise<string> {
    await editor.sendKey("Alt+q");
    await editor.sendKey("ArrowDown");
    const frame = await editor.waitForText((t) => t.includes(`Ln ${String(line)}, Col 1`), { timeoutMs: 5000 });
    return frameToText(frame);
}

export default defineScenario({
    name: "extension-storage",
    title: "Extension storage dirs and the setContext command",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32"],
    async run(editor) {
        // `run 1` доказывает, что globalStorageUri существует и пишется: счётчик
        // прочитан из файла, который расширение само туда положило.
        await editor.waitForText((t) => t.includes("Storage run 1") && t.includes("idle · fired 0"), {
            timeoutMs: 20_000,
        });
        await editor.capture("activated");

        // Ключа ещё нет — кейбинд расширения не резолвится, счётчик не двигается.
        if (!(await pressGateKey(editor, 2)).includes("idle · fired 0")) {
            throw new Error("alt+q сработал до setContext — when-условие расширения не гейтит кейбинд");
        }
        await editor.capture("not-armed");

        // setContext из расширения выставляет ключ — та же клавиша оживает.
        // `armed` в тексте пункта — подтверждение расширения, что вызов уже
        // вернулся: без него нажатие обгоняло бы RPC.
        await runCommand(editor, "Ext Storage Demo: Arm");
        await editor.waitForText((t) => t.includes("armed · fired 0"), { timeoutMs: 5000 });
        await editor.sendKey("Alt+q");
        await editor.waitForText((t) => t.includes("armed · fired 1"), { timeoutMs: 5000 });
        await editor.capture("armed");

        // И гаснет обратно: ключ — живое состояние, а не разовый флаг.
        await runCommand(editor, "Ext Storage Demo: Disarm");
        await editor.waitForText((t) => t.includes("idle · fired 1"), { timeoutMs: 5000 });
        if (!(await pressGateKey(editor, 3)).includes("idle · fired 1")) {
            throw new Error("alt+q сработал после setContext(false) — ключ не сбросился");
        }
        await editor.capture("disarmed");

        // Все три пути — в канале Output расширения. `storageUri` тут честно
        // отсутствует: папка-воркспейс в этом сценарии не открыта.
        await runCommand(editor, "Ext Storage Demo: Show Paths");
        await editor.waitForText((t) => t.includes("globalStorageUri") && t.includes("logUri"), { timeoutMs: 10_000 });
        await editor.capture("paths");
    },
});

