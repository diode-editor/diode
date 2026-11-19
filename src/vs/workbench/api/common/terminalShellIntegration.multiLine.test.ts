import { describe, expect, it } from "vitest";

import { LOW, setupShellIntegrations } from "../../../../TestUtils/shellIntegrationsHarness.ts";
import { settle } from "../../../../TestUtils/timing.ts";

// A multi-line `executeCommand`: each line is a command of its own to the shell, one execution to the extension.

/** Terminal 1 with its integration alive. */
function setup() {
    const h = setupShellIntegrations();
    h.send("terminal.shellIntegration.changed", { id: 1, supportsExecuteCommand: true });
    return {
        starts: h.starts,
        ends: h.ends,
        executeCommand: (commandLine: string) => h.integration(1).executeCommand(commandLine),
        start: (value: string, line?: typeof LOW) => {
            h.start(1, value, line);
        },
        end: (value: string, exitCode: number) => {
            h.end(1, value, exitCode);
        },
        data: (value: string) => {
            h.data(1, value);
        },
        close: () => {
            h.integrations.close(1);
        },
    };
}

/** A macrotask: the end event waits for the `read()` streams. */
const macrotask = (): Promise<void> => settle(0);

async function readAll(stream: AsyncIterable<string>): Promise<string> {
    let out = "";
    for await (const chunk of stream) out += chunk;
    return out;
}

describe("ext host shell integration — a multi-line executeCommand", () => {
    it("its lines are one execution: one start, the end after the last line with its code and the requested line", async () => {
        const h = setup();
        const execution = h.executeCommand("  echo a\n\n echo b \n");
        const output = readAll(execution.read());
        h.start("echo a");
        h.data("a");
        h.end("echo a", 0);
        h.start("echo b");
        h.data("b");
        await macrotask();
        expect(h.starts).toStrictEqual([execution]);
        expect(h.ends).toStrictEqual([]);
        h.end("echo b", 3);
        await macrotask();
        expect(h.ends).toStrictEqual([[execution, "  echo a\n\n echo b \n", 3]]);
        expect(await output).toBe("ab");
    });

    it("lines the shell runs as one command resolve together", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb\nc");
        h.start("a\nb");
        h.end("a\nb", 0);
        h.start("c");
        h.end("c", 0);
        await macrotask();
        expect(h.starts).toStrictEqual([execution]);
        expect(h.ends).toStrictEqual([[execution, "a\nb\nc", 0]]);
    });

    it("a command that is not its next line ends it without a code and starts on its own", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb");
        h.start("a");
        h.end("a", 0);
        h.start("other");
        h.end("other", 1);
        await macrotask();
        expect(h.starts.map((e) => e.commandLine.value)).toStrictEqual(["a\nb", "other"]);
        expect(h.starts[0]).toBe(execution);
        expect(h.ends.map(([, line, code]) => [line, code])).toStrictEqual([
            ["a\nb", undefined],
            ["other", 1],
        ]);
    });

    it("cut short by the terminal closing: it ends without a code", () => {
        const h = setup();
        h.executeCommand("a\nb");
        h.start("a");
        h.close();
        expect(h.ends.map(([, line, code]) => [line, code])).toStrictEqual([["a\nb", undefined]]);
    });

    it("an execution after a finished multi-line one takes the line the shell reports at its end", async () => {
        const h = setup();
        h.executeCommand("a\nb");
        h.start("a");
        h.end("a", 0);
        h.start("b");
        h.end("b", 0);
        h.start("l", LOW);
        h.end("ls", 0);
        await macrotask();
        expect(h.ends.map(([, line]) => line)).toStrictEqual(["a\nb", "ls"]);
    });

    it("a low-confidence start takes the oldest request: a single-line one, no lines held back", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb");
        h.start("whatever", LOW);
        h.end("whatever", 0);
        await macrotask();
        expect(h.starts).toStrictEqual([execution]);
        expect(h.ends.map(([, line]) => line)).toStrictEqual(["whatever"]);
    });

    it("a line that matches no request's first lines, or an empty one, starts an execution of its own", async () => {
        const h = setup();
        const execution = h.executeCommand("a\nb");
        h.start("b");
        h.end("b", 0);
        h.start("");
        h.end("", 0);
        h.start("a");
        await macrotask();
        expect(h.starts.map((e) => e.commandLine.value)).toStrictEqual(["b", "", "a\nb"]);
        expect(h.starts[2]).toBe(execution);
        expect(h.ends.map(([, line]) => line)).toStrictEqual(["b", ""]);
    });

    it("while its last lines run, an empty command line is no part of it", async () => {
        const h = setup();
        h.executeCommand("a\nb");
        h.start("a");
        h.start("");
        expect(h.starts.map((e) => e.commandLine.value)).toStrictEqual(["a\nb", ""]);
        expect(h.ends.map(([, line, code]) => [line, code])).toStrictEqual([["a\nb", undefined]]);
    });
});
