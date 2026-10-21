import { defineScenario, repoRoot } from "./framework.ts";

// Commands go through user keybindings: Ctrl+` is not available on every tier, and the palette ranks
// "View: Move Focused View" below "View: Move Editor…". The marker is split by an empty substitution
// (aux-term""-ok) so it appears whole only in the shell output.
// The prompt is matched by `$` or `❯` at the end of the line, not `"$ "`: the runner's rc files change PS1, and
// the frame trims trailing spaces.

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
    // A real PTY is Linux-only on CI, as in terminal.scenario.ts.
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

        // Window reload: TERMINAL stays on the right, and so does its width.
        await editor.sendKey("Ctrl+Alt+R");
        await editor.reconnect();
        part = await editor.waitForNode("#auxiliarybar");
        await editor.waitForText((t) => t.split("\n")[1].slice(part.box.x).includes("TERMINAL"));
        if (part.box.width !== 50) throw new Error(`после перезагрузки ширина ${part.box.width}, ждали 50`);
        // The shell starts on activation, same as in the bottom panel.
        await editor.sendKey("Ctrl+Alt+T");
        await editor.waitForText((t) => hasPrompt(t, part.box.x));
        await editor.capture("after-reload");
    },
});
