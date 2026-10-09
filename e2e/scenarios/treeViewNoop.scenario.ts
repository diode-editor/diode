import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Деревья расширений в TUI пока не рисуются — но расширение с деревом обязано
// активироваться ЦЕЛИКОМ. Фикстурное расширение `tree-outline` устроено как
// форк bazel-java: `class RunTarget extends vscode.TreeItem` на уровне модуля,
// а `activate()` СНАЧАЛА регистрирует дерево и только потом команду и свой
// output-канал. Раньше модуль не грузился вовсе («Class extends value
// undefined»), а без TreeItem — падал на `registerTreeDataProvider is not a
// function`; палитра оставалась без команды, след был только в diode.log.
//
// Сценарий показывает обе половины поведения: в Output одна строка, что дерева
// не будет, а команда расширения видна в палитре и исполняется.
//
// Клавиши — через user-кейбинды (общая договорённость сценариев, см. webviewNoop).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tree-outline");

export default defineScenario({
    name: "tree-view-noop",
    title: "Расширение с деревом живёт без панели дерева (Output + палитра)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux (как webviewNoop).
    skipOn: ["win32"],
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
        { key: "f7", command: "workbench.action.showCommands", args: "Tree Outline" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Канал Extensions: одна строка, что дерева не будет, вместо мёртвого расширения.
        await editor.sendKey("Alt+U");
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes('дерево "treeOutline.targets" в TUI пока не рисуется'), {
            timeoutMs: 15000,
        });
        await editor.capture("output-line");

        // Палитра с префиллом: команда расширения на месте — модуль загрузился,
        // и activate() дошёл до конца, а не умер на регистрации дерева.
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Tree Outline: List Targets"));
        await editor.capture("palette");

        // И она исполняется: расширение пишет узлы своего дерева в свой канал
        // и показывает его — Output переключается на Tree Outline.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("targets: //app:main, //lib:greeter"), { timeoutMs: 10000 });
        await editor.capture("command-executed");
    },
});
