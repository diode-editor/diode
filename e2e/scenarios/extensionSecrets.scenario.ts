import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `ExtensionContext.secrets` + каталог `vscode.extensions`. Фикстурное
// расширение `secrets-demo` делает то же, что первые строки любого
// AI-автодополнения: читает свой токен и осматривает соседей.
//
// Кадры показывают круг целиком: секрет из прошлого запуска (он лежит в
// `user-data/User/secrets.json` фикстуры — memento бы его не пережил) виден уже
// на первом кадре → `store` его перезаписал и разбудил `onDidChange` → `delete`
// убрал → каталог расширений напечатан в Output настоящим составом, а не
// пустым списком, каким он был до этой работы.

// Markdown и без папки-воркспейса — как в status-bar- и storage-сценариях:
// иначе полосу делят сегменты SCM и спиннер tsserver, и её раскладка плывёт.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-secrets-demo");

/** Исполняет команду расширения через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "extension-secrets",
    title: "Extension secrets and the extensions catalog",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32"],
    async run(editor) {
        // `token seeded` доказывает персист: значение прочитано из user-data в
        // activate(), до всякого взаимодействия с человеком.
        await editor.waitForText((t) => t.includes("token seeded") && t.includes("changes 0"), { timeoutMs: 20_000 });
        await editor.capture("seeded");

        // store перезаписывает секрет И будит onDidChange — счётчик двигается
        // не «по возврату вызова», а по событию от хоста.
        await runCommand(editor, "Secrets Demo: Store Token");
        await editor.waitForText((t) => t.includes("token rotated") && t.includes("changes 1"), { timeoutMs: 10_000 });
        await editor.capture("stored");

        // delete убирает его насовсем — расширение снова «без токена».
        await runCommand(editor, "Secrets Demo: Delete Token");
        await editor.waitForText((t) => t.includes("token none") && t.includes("changes 2"), { timeoutMs: 10_000 });
        await editor.capture("deleted");

        // Каталог: своя запись найдена и активна, отсутствующий сосед честно
        // отсутствует, `all` не пуст.
        await runCommand(editor, "Secrets Demo: Show Catalog");
        await editor.waitForText(
            (t) =>
                t.includes("getExtension(test.secrets-demo).isActive: true") &&
                t.includes("getExtension(ms-python.python): undefined") &&
                t.includes("test.secrets-demo=true"),
            { timeoutMs: 10_000 },
        );
        await editor.capture("catalog");
    },
});
