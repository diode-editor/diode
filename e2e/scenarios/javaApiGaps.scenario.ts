import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Своя фикстура, а не стоковый redhat.java: его записи в реестре магазина ещё нет, а сам он требует JDK 21.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "javaApiSample");
const sampleFile = resolve(sampleDir, "src", "main", "java", "com", "example", "App.java");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-java-api-probe");

export default defineScenario({
    name: "java-api-gaps",
    title: "env.uiKind, workspace.fs, findFiles и заглушка custom editor в одном activate()",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 120,
    rows: 26,
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+b", command: "workbench.action.toggleSidebarVisibility" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Java API sample"), { timeoutMs: 20_000 });

        // «ПРОВАЛ» в маркере означает, что какой-то шаг отказал.
        await editor.waitForText((t) => t.includes("java api: готово"), { timeoutMs: 30_000 });
        await editor.capture("activated");

        // Сайдбар прячем: перенос в панели выключен, и с проводником хвост длинной строки не попадает в кадр.
        await editor.sendKey("Alt+B");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Java API Probe: Show Report");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("uiKind=Desktop") && t.includes("telemetry=off"), {
            timeoutMs: 15_000,
        });
        await editor.waitForText((t) => t.includes("readDirectory=[pom.bak, pom.xml]"), { timeoutMs: 15_000 });
        // Чужая схема — `undefined`, а не «нельзя писать».
        await editor.waitForText((t) => t.includes("isWritableFileSystem file=true jdt=undefined"), {
            timeoutMs: 15_000,
        });
        // `exclude: undefined` применил `files.exclude` и срезал чужой pom, а `exclude: null` его находит — значит, файл
        // был, и отсеяли его мы.
        await editor.waitForText(
            (t) => t.includes("по умолчанию=[pom.xml]") && t.includes("без исключений=2") && t.includes("maxResults1=1"),
            { timeoutMs: 15_000 },
        );
        await editor.waitForText((t) => t.includes("итог: все шаги прошли"), { timeoutMs: 15_000 });
        await editor.capture("report");
    },
});
