import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Java: «Move type to new file» НАСТОЯЩЕГО redhat.java (jdt.ls) и его отмена.
// Путь как у пользователя VS Code: меню рефакторингов → «Move...» → quick pick
// расширения «Move type Helper to new file» (`refactorAction.ts` vscode-java:
// `java/move` с `moveTypeToNewFile`, правку расширение применяет само через
// `workspace.applyEdit`). Вторичный тип `Helper` из App.java уезжает в свой
// Helper.java; Ctrl+Z из исходника откатывает шаг целиком — новый файл уходит
// с диска, класс возвращается.
//
// Каталог наполняется в prepare: сценарий пишет на диск. pom.xml — тот же, что
// у java-lsp (проект без внешних зависимостей, ~/.m2 не нужен).

const sampleDir = mkdtempSync(join(tmpdir(), "diode-java-move-demo-"));
const packageDir = join(sampleDir, "src", "main", "java", "demo");
const appFile = join(packageDir, "App.java");
const helperFile = join(packageDir, "Helper.java");

const APP_JAVA = [
    "package demo;",
    "",
    "public class App {",
    "    public static void main(String[] args) {",
    "        System.out.println(new Helper().name());",
    "    }",
    "}",
    "",
    "class Helper {",
    "    String name() {",
    '        return "helper";',
    "    }",
    "}",
    "",
].join("\n");

export default defineScenario({
    name: "java-move-type-undo",
    title: "Java: Move type to new file (jdt.ls) и Ctrl+Z из любой затронутой вкладки",
    open: [sampleDir, appFile],
    installVsix: ["redhat.java"],
    network: true,
    settings: { "redhat.telemetry.enabled": false },
    userKeybindings: [{ key: "f6", command: "editor.action.refactor" }],
    // Установка 139-МБ vsix, импорт maven-проекта и две JVM — как у java-lsp.
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(packageDir, { recursive: true });
        copyFileSync(resolve(repoRoot, "e2e", "fixtures", "javaSample", "pom.xml"), join(sampleDir, "pom.xml"));
        writeFileSync(appFile, APP_JAVA);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("class Helper {"));

        // Каретка на `Helper` в объявлении (строка 9, колонка 6).
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 6; i++) await editor.sendKey("ArrowRight");
        // Рефакторинги jdt.ls отдаёт, только когда импортировал проект:
        // переоткрываем меню, пока пункт не появится (см. java-lsp).
        const deadline = Date.now() + 400_000;
        for (;;) {
            await editor.sendKey("F6");
            try {
                await editor.waitForText((t) => t.includes("Move..."), { timeoutMs: 15_000 });
                break;
            } catch (error) {
                if (Date.now() > deadline) throw error;
                await editor.sendKey("Escape");
            }
        }
        await editor.capture("menu");
        await editor.sendText("Move...");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Move type Helper to new file"), { timeoutMs: 60_000 });
        await editor.sendText("new file");
        await editor.sendKey("Enter");

        await waitUntil(
            () => Promise.resolve(existsSync(helperFile) ? readFileSync(helperFile, "utf8") : ""),
            (text) => text.includes("class Helper"),
            { describe: "класс Helper в новом Helper.java на диске", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.includes("public class App {") && !t.includes("class Helper {"), {
            timeoutMs: 60_000,
        });
        await editor.capture("moved");

        // Ctrl+Z из исходника: шаг целиком — новый файл уходит с диска.
        await editor.sendKey("Ctrl+Z");
        await waitUntil(
            () => Promise.resolve(existsSync(helperFile)),
            (exists) => !exists,
            { describe: "Helper.java убран отменой", timeoutMs: 30_000, intervalMs: 250 },
        );
        await editor.waitForText((t) => t.includes("class Helper {"));
        await editor.capture("undone");
    },
});
