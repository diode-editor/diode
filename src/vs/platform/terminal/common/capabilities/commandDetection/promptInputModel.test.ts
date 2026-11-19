import { Terminal } from "@xterm/headless";
import { afterEach, describe, expect, it } from "vitest";

import { ShellIntegrationAddon } from "../../xterm/shellIntegrationAddon.ts";

// The model on a real headless emulator, fed what a shell with the integration script writes.

const vsc = (pt: string): string => `\x1b]633;${pt}\x07`;
const ft = (pt: string): string => `\x1b]133;${pt}\x07`;

const disposables: { dispose(): void }[] = [];
afterEach(() => {
    for (const d of disposables.splice(0)) d.dispose();
});

function make(scrollback = 100) {
    const term = new Terminal({ cols: 20, rows: 3, scrollback, allowProposedApi: true });
    const addon = new ShellIntegrationAddon("nonce");
    addon.activate(term);
    disposables.push(addon, term);
    const write = (data: string) =>
        new Promise<void>((resolve) => {
            term.write(data, resolve);
        });
    const model = () => {
        const detection = addon.capabilities.get("commandDetection");
        if (detection === undefined) throw new Error("no command detection");
        return detection.promptInputModel;
    };
    return { write, model };
}

describe("PromptInputModel — the prompt's state and what is typed on it", () => {
    it("unknown after the prompt start, input from B (once), execute from C; the value is the text after B", async () => {
        const { write, model } = make();
        await write(`${vsc("A")}$ `);
        expect(model().state).toBe("unknown");
        expect(model().value).toBe("");
        const starts: string[] = [];
        model().onDidStartInput(() => starts.push(model().state));

        await write(vsc("B"));
        expect(model().state).toBe("input");
        expect(model().value).toBe("");
        await write("abc  ");
        expect(model().value).toBe("abc");
        // A repeated B while the prompt takes input (a redrawn prompt) is no new start; the latest is read.
        await write(`\r\x1b[K> ${vsc("B")}xy`);
        expect(starts).toStrictEqual(["input"]);
        expect(model().value).toBe("xy");

        await write(`\r\n${vsc("C")}output`);
        expect(model().state).toBe("execute");
        expect(model().value).toBe("");
        await write(`\r\n${vsc("D;0")}`);
        expect(model().state).toBe("execute");
        expect(model().value).toBe("");

        await write(`${vsc("A")}$ ${vsc("B")}`);
        expect(model().state).toBe("input");
        expect(starts).toStrictEqual(["input", "input"]);
    });

    it("133;B and 133;C drive it too; a D without C (Ctrl+C on the prompt) ends the input", async () => {
        const { write, model } = make();
        await write(`${ft("A")}> ${ft("B")}typed`);
        expect(model().state).toBe("input");
        expect(model().value).toBe("typed");
        await write(`^C\r\n${ft("D")}`);
        expect(model().state).toBe("execute");
        await write(`${ft("A")}> ${ft("B")}`);
        expect(model().state).toBe("input");
        await write(ft("C"));
        expect(model().state).toBe("execute");
    });

    it("a command wrapped onto the next rows is read up to the cursor's row, from column 0 there", async () => {
        const { write, model } = make();
        await write(`${vsc("A")}$ ${vsc("B")}${"x".repeat(18)}yy z`);
        expect(model().value).toBe(`${"x".repeat(18)}yy z`);
    });

    it("a start pushed out of the scrollback reads the rows still there", async () => {
        const { write, model } = make(0);
        await write(`${vsc("A")}$ ${vsc("B")}${"a".repeat(18)}${"b".repeat(20)}${"c".repeat(20)}d`);
        expect(model().value).toBe(`${"b".repeat(20)}${"c".repeat(20)}d`);
    });

    it("no input in the alternate buffer: a B there has no mark", async () => {
        const { write, model } = make();
        await write(`${vsc("A")}\x1b[?1049h${vsc("B")}abc`);
        expect(model().state).toBe("unknown");
    });
});
