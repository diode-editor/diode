import { defineScenario, repoRoot } from "./framework.ts";

// Команды — пользовательскими биндами: Ctrl+` есть не на всех tier'ах, а палитра ранжирует
// «View: Move Focused View» ниже «View: Move Editor…». Маркер разорван пустой подстановкой (aux-term""-ok):
// целиком он появляется только в выводе шелла.
// Приглашение ждём по `$` или `❯` в конце строки, а не `"$ "`: rc-файлы раннера меняют PS1, а кадр обрезает
// хвостовые пробелы.

function hasPrompt(text: string, fromX = 0): boolean {
    return text.split("\n").some((row) => {
        const tail = row.slice(fromX).trimEnd();
        return tail.endsWith("$") || tail.includes("❯");
    });
}

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

        await editor.sendKey("Ctrl+Alt+T");
        await editor.waitForText((t) => t.includes("TERMINAL") && hasPrompt(t));

        await editor.sendKey("Ctrl+Alt+M");
        await editor.waitForText((t) => t.includes("View: Move TERMINAL"));
        await editor.sendText("New Secondary");
        await editor.waitForText((t) => t.includes("New Secondary Side Bar Entry"));
        await editor.sendKey("Enter");
        let part = await editor.waitForNode("#auxiliarybar");
        await editor.waitForText((t) => t.split("\n")[1].slice(part.box.x).includes("TERMINAL"));
        await editor.capture("moved");

        await editor.sendText('echo aux-term""-ok');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.split("\n").some((row) => row.slice(part.box.x).includes("aux-term-ok")));
        await editor.capture("shell-live");

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
        await editor.waitForText((t) => hasPrompt(t, part.box.x));
        await editor.capture("after-reload");
    },
});
