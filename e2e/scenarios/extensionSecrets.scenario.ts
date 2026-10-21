import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Секрет из прошлого запуска лежит в `user-data/User/secrets.json` фикстуры — memento бы его не пережил.

// Markdown без папки: иначе полосу делят сегменты SCM и спиннер tsserver, и раскладка плывёт.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-secrets-demo");

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
    skipOn: ["win32"],
    async run(editor) {
        // `token seeded` доказывает персист: значение прочитано в activate(), до всякого взаимодействия.
        await editor.waitForText((t) => t.includes("token seeded") && t.includes("changes 0"), { timeoutMs: 20_000 });
        await editor.capture("seeded");

        // Счётчик двигается по событию onDidChange от хоста, а не по возврату store.
        await runCommand(editor, "Secrets Demo: Store Token");
        await editor.waitForText((t) => t.includes("token rotated") && t.includes("changes 1"), { timeoutMs: 10_000 });
        await editor.capture("stored");

        await runCommand(editor, "Secrets Demo: Delete Token");
        await editor.waitForText((t) => t.includes("token none") && t.includes("changes 2"), { timeoutMs: 10_000 });
        await editor.capture("deleted");

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
