import { defineScenario, repoRoot } from "./framework.ts";

// Приёмка вторичной боковой панели (docs/TODO/SecondarySideBar.md): вид TERMINAL
// переносится из нижней панели во вторичную боковую и живёт там — живой шелл,
// ввод, ресайз сашем, переживание перезагрузки окна. Ради этого и делалась
// часть: держать терминал с `claude` справа.
//
// Команды — пользовательскими биндами: Ctrl+` есть не на всех tier'ах, а
// палитра ранжирует «View: Move Focused View» ниже «View: Move Editor…».
// Маркер вывода разорван пустой подстановкой (aux-term""-ok): целиком он
// появляется только в выводе шелла (см. terminal.scenario.ts).

export default defineScenario({
    name: "auxiliary-bar-terminal",
    title: "TERMINAL во вторичной боковой панели: живой шелл справа",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    // Настоящий PTY — только Linux на CI, как у terminal.scenario.ts.
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "ctrl+alt+t", command: "workbench.action.terminal.focus" },
        { key: "ctrl+alt+m", command: "workbench.action.moveFocusedView" },
        { key: "ctrl+alt+r", command: "workbench.action.reloadWindow" },
    ],
    async run(editor) {
        await editor.waitForReady();

        // Терминал в нижней панели, фокус в нём.
        await editor.sendKey("Ctrl+Alt+T");
        await editor.waitForText((t) => t.includes("TERMINAL") && (t.includes("$ ") || t.includes("❯")));

        // Move Focused View → New Secondary Side Bar Entry.
        await editor.sendKey("Ctrl+Alt+M");
        await editor.waitForText((t) => t.includes("View: Move TERMINAL"));
        await editor.sendText("New Secondary");
        await editor.waitForText((t) => t.includes("New Secondary Side Bar Entry"));
        await editor.sendKey("Enter");
        let part = await editor.waitForNode("#auxiliarybar");
        await editor.waitForText((t) => t.split("\n")[1].slice(part.box.x).includes("TERMINAL"));
        await editor.capture("moved");

        // Шелл живой и получает ввод уже справа.
        await editor.sendText('echo aux-term""-ok');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.split("\n").some((row) => row.slice(part.box.x).includes("aux-term-ok")));
        await editor.capture("shell-live");

        // Саш на первой колонке части: тянем на 20 колонок шире — эмулятор следует.
        const midY = part.box.y + Math.floor(part.box.height / 2);
        await editor.sendMouse({ action: "press", button: "left", x: part.box.x, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: part.box.x - 20, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: part.box.x - 20, y: midY });
        part = await editor.waitForNode("#auxiliarybar");
        if (part.box.width !== 50) throw new Error(`ширина вторичной панели ${part.box.width}, ждали 50`);
        await editor.capture("resized");

        // Перезагрузка окна: TERMINAL остаётся справа, ширина — тоже.
        await editor.sendKey("Ctrl+Alt+R");
        await editor.reconnect();
        part = await editor.waitForNode("#auxiliarybar");
        await editor.waitForText((t) => t.split("\n")[1].slice(part.box.x).includes("TERMINAL"));
        if (part.box.width !== 50) throw new Error(`после перезагрузки ширина ${part.box.width}, ждали 50`);
        // Шелл поднимается по активации, как и в нижней панели.
        await editor.sendKey("Ctrl+Alt+T");
        await editor.waitForText((t) => t.split("\n").some((row) => row.slice(part.box.x).includes("$ ")));
        await editor.capture("after-reload");
    },
});
