import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Расширение поднимает ТОТ ЖЕ оверлей, что палитра и Quick Open; ответ печатается в канал Output
// «Diode Probe» — по нему видно, что введённое доехало до расширения.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-quick-input-probe");

async function runProbeCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "quick-input",
    title: "Расширение просит строку и выбор (showInputBox / showQuickPick)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // Только Linux: субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Probe"), { timeoutMs: 30000 });

        await runProbeCommand(editor, "Ask Port");
        await editor.waitForText((t) => t.includes("Порт сервера"), { timeoutMs: 20000 });
        await editor.capture("input-box");

        await editor.sendText("ab");
        await editor.waitForText((t) => t.includes("Только цифры"));
        await editor.capture("error-message");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Только цифры"));

        await editor.sendKey("Backspace");
        await editor.sendKey("Backspace");
        await editor.sendText("80");
        await editor.waitForText((t) => t.includes("Порт < 1024"));
        await editor.capture("warning-message");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Port: 80"), { timeoutMs: 20000 });
        await editor.capture("input-accepted");

        // Расширение получает настоящий текст — это проверяется по его длине.
        await runProbeCommand(editor, "Ask Secret");
        await editor.waitForText((t) => t.includes("Набранное закрыто маской"), { timeoutMs: 20000 });
        await editor.sendText("hunter2");
        await editor.waitForText((t) => t.includes("*******") && !t.includes("hunter2"));
        await editor.capture("password-masked");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Secret length: 7"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Pick Fruit");
        await editor.waitForText((t) => t.includes("Выберите фрукт") && t.includes("cherry"), { timeoutMs: 20000 });
        await editor.capture("quick-pick");

        await editor.sendText("ch");
        await editor.waitForText((t) => t.includes("cherry") && !t.includes("banana"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Fruit: cherry"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Pick Many (preselected)");
        await editor.waitForText((t) => t.includes("[✓] beta"), { timeoutMs: 20000 });
        await editor.capture("multi-select");

        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[✓] alpha"));
        await editor.capture("multi-select-checked");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Picked: alpha, beta"), { timeoutMs: 20000 });
        await editor.capture("multi-select-accepted");

        // Пикер открывается пустым, предметы приезжают позже — как у `Go: Maintain gopls` (golang.go, pickLazyEnum).
        await runProbeCommand(editor, "Lazy Pick");
        await editor.waitForText((t) => t.includes("Lazy enum") && t.includes("Alpha module"), {
            timeoutMs: 20000,
        });
        await editor.capture("create-quick-pick");

        await editor.sendText("beta");
        await editor.waitForText((t) => t.includes("Найдено по «beta»") && !t.includes("Alpha module"));
        await editor.capture("create-quick-pick-filtered");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Lazy: example.com/beta"), { timeoutMs: 20000 });

        await runProbeCommand(editor, "Open File Dialog");
        // Каталоги идут раньше файлов, README в корне ниже видимой части — ждём каталог, который виден всегда.
        await editor.waitForText((t) => t.includes("Pick a file") && t.includes(".github"), { timeoutMs: 20000 });
        await editor.capture("file-dialog");
        await editor.sendText("READ");
        await editor.waitForText((t) => t.includes("README.md") && t.includes("Pick a file"));
        await editor.capture("file-dialog-typed");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Opened: ") && t.includes("README"), { timeoutMs: 20000 });

        // Свой потребитель оверлея не сломан: после множественного выбора чекбоксов в палитре нет.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.waitForText((t) => t.includes("File: Save"));
        await editor.capture("palette-intact");
        await editor.sendKey("Escape");
    },
});
