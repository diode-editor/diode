import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Пять поверхностей API, без которых стоковый `redhat.java` (jdt.ls) не доживал
// до конца `activate()`: `env.uiKind`/`sessionId`/телеметрия, мутирующая
// половина `workspace.fs`, `workspace.findFiles` и заглушка
// `registerCustomEditorProvider`.
//
// Демо на своей фикстуре, а не на стоковом расширении: записи `redhat.java` в
// реестре магазина ещё нет (отдельная задача — платформенные vsix с вшитым JRE),
// а сам он требует JDK 21 и полминуты на подъём сервера. По конвенции AGENTS.md
// герметичный контракт и закрывается герметичной фикстурой.
//
// Кадры показывают обе половины работы:
//   1. `activated` — расширение дошло до конца `activate()`: маркер в полосе.
//      До этой работы оно умирало на первом же `env.uiKind`;
//   2. `report` — канал Output с результатом каждого шага. Главная строка —
//      `findFiles`: по умолчанию виден ТОЛЬКО корневой `pom.xml`, а чужой
//      `pom.xml` внутри `node_modules` (его расширение само создало через
//      `workspace.fs`) срезан дефолтным исключением. Без исключений он находится.

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
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+b", command: "workbench.action.toggleSidebarVisibility" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Java API sample"), { timeoutMs: 20_000 });

        // `activate()` дошёл до конца — маркер ставится последней строкой.
        // «ПРОВАЛ» в маркере означает, что какой-то шаг отказал.
        await editor.waitForText((t) => t.includes("java api: готово"), { timeoutMs: 30_000 });
        await editor.capture("activated");

        // Отчёт в Output. Сайдбар прячем: строки длинные, перенос в панели
        // выключен, и с проводником хвост строки не попадает в кадр.
        await editor.sendKey("Alt+B");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Java API Probe: Show Report");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("uiKind=Desktop") && t.includes("telemetry=off"), {
            timeoutMs: 15_000,
        });
        await editor.waitForText((t) => t.includes("readDirectory=[pom.bak, pom.xml]"), { timeoutMs: 15_000 });
        // Чужая схема — честный `undefined`, а не «нельзя писать».
        await editor.waitForText((t) => t.includes("isWritableFileSystem file=true jdt=undefined"), {
            timeoutMs: 15_000,
        });
        // Ядро демо: `exclude: undefined` применил настройку `files.exclude` и
        // срезал чужой pom из служебного каталога VCS, а `exclude: null` его
        // находит — значит файл был, и отсеяли его мы.
        await editor.waitForText(
            (t) => t.includes("по умолчанию=[pom.xml]") && t.includes("без исключений=2") && t.includes("maxResults1=1"),
            { timeoutMs: 15_000 },
        );
        await editor.waitForText((t) => t.includes("итог: все шаги прошли"), { timeoutMs: 15_000 });
        await editor.capture("report");
    },
});
