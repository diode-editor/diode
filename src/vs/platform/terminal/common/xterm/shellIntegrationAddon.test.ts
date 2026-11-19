import { Terminal } from "@xterm/headless";
import { afterEach, describe, expect, it } from "vitest";

import type { ITerminalCommand } from "../capabilities/capabilities.ts";
import { CommandDetectionCapability } from "../capabilities/commandDetectionCapability.ts";
import { CwdDetectionCapability } from "../capabilities/cwdDetectionCapability.ts";

import {
    deserializeVSCodeOscMessage,
    parseKeyValueAssignment,
    ShellIntegrationAddon,
    splitProcessData,
} from "./shellIntegrationAddon.ts";

// The addon on a real headless emulator: sequences are written as process output and parsed by xterm.

const NONCE = "nonce-1";
const vsc = (pt: string): string => `\x1b]633;${pt}\x07`;
const ft = (pt: string): string => `\x1b]133;${pt}\x07`;

const disposables: { dispose(): void }[] = [];
/** Sequences the addon declined (its handler returned `false`), per terminal; a test takes what it expects. */
const unhandledLists: string[][] = [];
afterEach(() => {
    for (const unhandled of unhandledLists.splice(0)) expect(unhandled).toStrictEqual([]);
    for (const d of disposables.splice(0)) d.dispose();
});

function make(scrollback?: number) {
    const term = new Terminal({
        cols: 40,
        rows: 5,
        allowProposedApi: true,
        ...(scrollback === undefined ? {} : { scrollback }),
    });
    // Registered first, so xterm calls it last: it sees only what the addon returned `false` for.
    const unhandled: string[] = [];
    unhandledLists.push(unhandled);
    for (const id of [7, 133, 633, 1337]) {
        term.parser.registerOscHandler(id, (data) => {
            unhandled.push(`${id};${data}`);
            return true;
        });
    }
    const addon = new ShellIntegrationAddon(NONCE);
    addon.activate(term);
    disposables.push(addon, term);
    const events: string[] = [];
    const executed: ITerminalCommand[] = [];
    const finished: ITerminalCommand[] = [];
    addon.capabilities.onDidAddCapability((e) => events.push(`add ${e.id}`));
    addon.capabilities.onDidRemoveCapability((e) => events.push(`remove ${e.id}`));
    addon.capabilities.onDidAddCommandDetectionCapability((detection) => {
        events.push("integration on");
        detection.onCommandExecuted((c) => executed.push(c));
        detection.onCommandFinished((c) => finished.push(c));
    });
    const write = (data: string) =>
        new Promise<void>((resolve) => {
            term.write(data, resolve);
        });
    const screen = () => term.buffer.active.getLine(0)?.translateToString(true) ?? "";
    const takeUnhandled = () => unhandled.splice(0);
    return { term, addon, events, executed, finished, write, screen, takeUnhandled };
}

describe("deserializeVSCodeOscMessage / parseKeyValueAssignment", () => {
    it("`\\\\` is a backslash, `\\xAB` the character with that code (either case); anything else stays", () => {
        expect(deserializeVSCodeOscMessage("a\\\\b\\x3bc\\x3Bd\\x0a\\q\\x4")).toBe("a\\b;c;d\n\\q\\x4");
    });

    it("splits at the first `=`; no `=` — no value", () => {
        expect(parseKeyValueAssignment("Cwd=/a=b")).toStrictEqual({ key: "Cwd", value: "/a=b" });
        expect(parseKeyValueAssignment("Cwd")).toStrictEqual({ key: "Cwd", value: undefined });
        expect(parseKeyValueAssignment("=x")).toStrictEqual({ key: "", value: "x" });
    });
});

describe("splitProcessData", () => {
    it("each C and D (633 or 133, with or without an exit code) is a piece of its own", () => {
        const data = `pre${vsc("C")}out${vsc("D;12")}mid${ft("C")}x${ft("D")}${vsc("A")}post`;
        expect(splitProcessData(data)).toStrictEqual([
            "pre",
            vsc("C"),
            "out",
            vsc("D;12"),
            "mid",
            ft("C"),
            "x",
            ft("D"),
            `${vsc("A")}post`,
        ]);
    });

    it("data without them is one piece; a sequence cut between chunks is not recognized", () => {
        expect(splitProcessData("plain")).toStrictEqual(["plain"]);
        expect(splitProcessData("")).toStrictEqual([""]);
        expect(splitProcessData(`${vsc("C")}${vsc("D")}`)).toStrictEqual([vsc("C"), vsc("D")]);
        expect(splitProcessData("out\x1b]633;")).toStrictEqual(["out\x1b]633;"]);
        expect(splitProcessData(vsc("D;x"))).toStrictEqual([vsc("D;x")]);
    });
});

describe("ShellIntegrationAddon — commands", () => {
    it("A B E C <output> D;2 — one command: the trusted line, high confidence, exit 2; nothing on screen", async () => {
        const { write, executed, finished, events, addon, screen } = make();
        await write(`${vsc("A")}${vsc("B")}${vsc(`E;echo hi\\x3b x;${NONCE}`)}${vsc("C")}hi`);
        expect(events).toStrictEqual(["add commandDetection", "integration on"]);
        expect(executed).toHaveLength(1);
        expect(executed[0]).toMatchObject({ command: "echo hi; x", commandLineConfidence: "high", isTrusted: true });
        expect(executed[0].exitCode).toBeUndefined();
        expect(addon.capabilities.get("commandDetection")?.executingCommand).toBe(executed[0]);
        await write(vsc("D;2"));
        expect(finished).toStrictEqual([executed[0]]);
        expect(finished[0].exitCode).toBe(2);
        expect(addon.capabilities.get("commandDetection")?.executingCommand).toBeUndefined();
        expect(addon.capabilities.get("commandDetection")?.commands).toStrictEqual([executed[0]]);
        expect(screen()).toBe("hi");
    });

    it("the command line's nonce: a foreign one or none — not trusted", async () => {
        const { write, finished } = make();
        await write(`${vsc("B")}${vsc("E;a;other")}${vsc("D;0")}`);
        await write(`${vsc("B")}${vsc("E;b")}${vsc("D;0")}`);
        await write(`${vsc("B")}${vsc("E")}${vsc("D;0")}`);
        expect(finished.map((c) => [c.command, c.isTrusted, c.commandLineConfidence])).toStrictEqual([
            ["a", false, "high"],
            ["b", false, "high"],
            ["", false, "high"],
        ]);
    });

    it("unicode survives the command line", async () => {
        const { write, finished } = make();
        await write(`${vsc("B")}${vsc(`E;echo\\x20γειά 🚀;${NONCE}`)}${vsc("C")}${vsc("D;0")}`);
        expect(finished[0].command).toBe("echo γειά 🚀");
    });

    it("without E the line is read from the buffer: medium after a prompt, low when nothing is to the left", async () => {
        const { write, finished } = make();
        await write(`${vsc("A")}$ ${vsc("B")}ls -la${vsc("C")}\r\nout\r\n${vsc("D;0")}`);
        await write(`${vsc("B")}pwd${vsc("C")}\r\n${vsc("D;0")}`);
        await write(`${vsc("A")}${vsc("B")}ls${vsc("C")}\r\n${vsc("D;0")}`);
        await write(`$ ${vsc("B")}ls${vsc("C")}\r\n${vsc("D;0")}`);
        expect(finished.map((c) => [c.command, c.commandLineConfidence, c.isTrusted])).toStrictEqual([
            ["ls -la", "medium", false],
            ["pwd", "low", false],
            ["ls", "low", false],
            ["ls", "low", false],
        ]);
    });

    it("a command wrapped past the line end is read whole", async () => {
        const { write, finished } = make();
        const long = "x".repeat(50);
        await write(`${vsc("A")}$ ${vsc("B")}${long}${vsc("C")}\r\n${vsc("D;0")}`);
        expect(finished[0].command).toBe(long);
    });

    it("the line ends at the cursor: text to its right (a right prompt) is not the command", async () => {
        const { write, finished } = make();
        await write(`${vsc("A")}$ ${vsc("B")}ls  12:00\x1b[7D${vsc("C")}\r\n${vsc("D;0")}`);
        expect(finished[0].command).toBe("ls");
    });

    it("E after C (fish 4 sends its own 133;C first): the start has the buffer's line, the end the reported one", async () => {
        const { write, executed, finished } = make();
        await write(`${vsc("A")}$ ${vsc("B")}ls${ft("C")}`);
        expect(executed.map((c) => [c.command, c.commandLineConfidence, c.isTrusted])).toStrictEqual([
            ["ls", "medium", false],
        ]);
        const started = { ...executed[0] };
        expect(started.command).toBe("ls");
        await write(`${vsc(`E;ls -a;${NONCE}`)}${vsc("C")}\r\n${ft("D;0")}${vsc("D;0")}`);
        expect(executed).toHaveLength(1);
        expect(finished.map((c) => [c.command, c.commandLineConfidence, c.isTrusted, c.exitCode])).toStrictEqual([
            ["ls -a", "high", true, 0],
        ]);
    });

    it("a command start trimmed out of the buffer before C: its line is skipped, the rest is read", async () => {
        const { write, executed } = make(0);
        await write(`${vsc("A")}$ ${vsc("B")}ls${"\r\n".repeat(6)}-a${vsc("C")}`);
        expect(executed.map((c) => [c.command, c.commandLineConfidence])).toStrictEqual([["-a", "medium"]]);
    });

    it("the start's mark lives until C; a start without C loses it on reset", async () => {
        const { write, term, addon } = make();
        await write(`${vsc("A")}$ ${vsc("B")}ls`);
        expect(term.markers).toHaveLength(1);
        await write(vsc("C"));
        expect(term.markers).toHaveLength(0);
        await write(`${vsc("D;0")}${vsc("A")}$ ${vsc("B")}`);
        expect(term.markers).toHaveLength(1);
        addon.reset();
        expect(term.markers).toHaveLength(0);
    });

    it("a disposed command detection reports nothing more", async () => {
        const { write, addon, executed, finished } = make();
        await write(`${vsc("A")}$ ${vsc("B")}ls`);
        const detection = addon.capabilities.get("commandDetection");
        addon.reset();
        detection?.handleCommandExecuted();
        detection?.handleCommandFinished(0);
        expect([executed, finished]).toStrictEqual([[], []]);
    });

    it("a repeated C does not start the command again", async () => {
        const { write, executed, finished } = make();
        await write(`${vsc("B")}${vsc("C")}${vsc("C")}${vsc("D;0")}`);
        expect(executed).toHaveLength(1);
        expect(finished).toHaveLength(1);
    });

    it("empty Enter (A B D, no code): the command starts and ends with an empty line and no exit code", async () => {
        const { write, executed, finished } = make();
        await write(`${vsc("A")}${vsc("B")}${vsc("D")}`);
        expect(executed).toHaveLength(1);
        expect(finished[0]).toMatchObject({ command: "", exitCode: undefined });
    });

    it("C or D without B — no command", async () => {
        const { write, executed, finished, events } = make();
        await write(`${vsc("A")}${vsc("C")}${vsc("D;1")}`);
        expect(events).toStrictEqual(["add commandDetection", "integration on"]);
        expect(executed).toHaveLength(0);
        expect(finished).toHaveLength(0);
    });

    it("B in the alternate buffer has no mark — the command never runs", async () => {
        const { write, executed } = make();
        await write(`\x1b[?1049h${vsc("B")}${vsc("C")}`);
        expect(executed).toHaveLength(0);
    });

    it("133 (FinalTerm): the same marks; D with a code, without one, with extra arguments", async () => {
        const { write, finished } = make();
        await write(`${ft("A")}$ ${ft("B")}make${ft("C")}\r\n${ft("D;5")}`);
        await write(`${ft("B")}${ft("D")}`);
        await write(`${ft("B")}${ft("C")}${ft("D;1;x")}`);
        expect(finished.map((c) => [c.command, c.commandLineConfidence, c.exitCode])).toStrictEqual([
            ["make", "medium", 5],
            ["", "low", undefined],
            ["", "low", undefined],
        ]);
    });

    it("an unknown 133 or 633 code and an unknown 633 property are declined and print nothing", async () => {
        const { write, screen, events, takeUnhandled } = make();
        await write(`${ft("Z")}${vsc("Z;1")}${vsc("P;Unknown=1")}ok`);
        expect(takeUnhandled()).toStrictEqual(["133;Z", "633;Z;1", "633;P;Unknown=1"]);
        expect(screen()).toBe("ok");
        expect(events).toStrictEqual([]);
    });

    it("the sequences that only feed upstream UI are accepted; the command ones turn integration on", async () => {
        const { write, events, screen } = make();
        await write(`${vsc("SetMark;Id=1")}${vsc("P;PromptType=x")}${vsc("P;Task=True")}${vsc("P;NoValue")}`);
        expect(events).toStrictEqual([]);
        for (const pt of [
            "F",
            "G",
            "H",
            "I",
            "P;IsWindows=False",
            "P;HasRichCommandDetection=True",
            "P;Prompt=$ ",
            "P;ContinuationPrompt=> ",
        ]) {
            const fresh = make();
            await fresh.write(vsc(pt));
            expect(fresh.events, pt).toStrictEqual(["add commandDetection", "integration on"]);
        }
        expect(screen()).toBe("");
    });

    it("reset (relaunch): the capabilities go; the next process turns integration on again", async () => {
        const { write, addon, events } = make();
        await write(`${vsc("P;Cwd=/a")}${vsc("A")}`);
        addon.reset();
        expect(addon.capabilities.has("commandDetection")).toBe(false);
        expect(addon.capabilities.has("cwdDetection")).toBe(false);
        await write(vsc("A"));
        expect(events).toStrictEqual([
            "add cwdDetection",
            "add commandDetection",
            "integration on",
            "remove cwdDetection",
            "remove commandDetection",
            "add commandDetection",
            "integration on",
        ]);
    });
});

describe("ShellIntegrationAddon — cwd", () => {
    it("the cwd starts empty and trusted: such a first report is no change, an untrusted one is", async () => {
        const { write, addon } = make();
        const changes: string[] = [];
        addon.capabilities.onDidAddCapability(({ capability }) => {
            if ("onDidChangeCwd" in capability) capability.onDidChangeCwd((c) => changes.push(`[${c}]`));
        });
        await write(vsc(`P;Cwd=;${NONCE}`));
        expect(changes).toStrictEqual([]);
        await write(vsc("P;Cwd="));
        expect(changes).toStrictEqual(["[]"]);
    });

    it("P;Cwd with the nonce is trusted, without it or with another — not; the cwd alone does not turn integration on", async () => {
        const { write, addon, events } = make();
        const changes: string[] = [];
        await write(vsc(`P;Cwd=/home/u;${NONCE}`));
        const cwd = addon.capabilities.get("cwdDetection");
        cwd?.onDidChangeCwd((c) => changes.push(`${c} ${String(cwd.isTrusted)}`));
        expect([cwd?.getCwd(), cwd?.isTrusted]).toStrictEqual(["/home/u", true]);
        await write(vsc("P;Cwd=/home/u"));
        await write(vsc("P;Cwd=/home/u;bad"));
        await write(vsc(`P;Cwd=/x\\x3by;${NONCE}`));
        await write(vsc(`P;Cwd=/x\\x3by;${NONCE}`));
        expect(changes).toStrictEqual(["/home/u false", "/x;y true"]);
        expect(events).toStrictEqual(["add cwdDetection"]);
    });

    it("`633;P;Cwd` without `=` or a bare `633;P` sets no cwd", async () => {
        const { write, addon, screen } = make();
        await write("\x1b]633;P;Cwd\x07\x1b]633;P\x07");
        expect(addon.capabilities.has("cwdDetection")).toBe(false);
        expect(screen()).toBe("");
    });

    it("OSC 7: a file URI, percent-decoded, untrusted; another scheme or no path is declined", async () => {
        const { write, addon, screen, takeUnhandled } = make();
        await write("\x1b]7;file://host/tmp/a%20b/\x07");
        const cwd = addon.capabilities.get("cwdDetection");
        expect([cwd?.getCwd(), cwd?.isTrusted]).toStrictEqual(["/tmp/a b/", false]);
        await write("\x1b]7;http://host/x/\x07\x1b]7;file://host\x07\x1b]7;x-file://host/y/\x07");
        expect(takeUnhandled()).toStrictEqual(["7;http://host/x/", "7;file://host", "7;x-file://host/y/"]);
        expect(cwd?.getCwd()).toBe("/tmp/a b/");
        expect(screen()).toBe("");
    });

    it("OSC 1337 CurrentDir: untrusted, no escapes interpreted; another key is declined, SetMark and a bare key accepted", async () => {
        const { write, addon, takeUnhandled } = make();
        await write("\x1b]1337;CurrentDir=/srv/\\x41\x07");
        const cwd = addon.capabilities.get("cwdDetection");
        expect([cwd?.getCwd(), cwd?.isTrusted]).toStrictEqual(["/srv/\\x41", false]);
        await write("\x1b]1337;Other=1\x07\x1b]1337;SetMark\x07\x1b]1337;NoValue\x07");
        expect(takeUnhandled()).toStrictEqual(["1337;Other=1"]);
        expect(cwd?.getCwd()).toBe("/srv/\\x41");
    });

    it("a quoted cwd loses its quotes; unicode stays", async () => {
        const { write, addon } = make();
        await write(vsc(`P;Cwd="/tmp/φάκελος";${NONCE}`));
        expect(addon.capabilities.get("cwdDetection")?.getCwd()).toBe("/tmp/φάκελος");
        // Only a pair around the whole path is quoting.
        await write(vsc(`P;Cwd=/x'y';${NONCE}`));
        expect(addon.capabilities.get("cwdDetection")?.getCwd()).toBe("/x'y'");
        await write(vsc(`P;Cwd='/a'b;${NONCE}`));
        expect(addon.capabilities.get("cwdDetection")?.getCwd()).toBe("'/a'b");
    });

    it("a command takes the cwd known at its start (B)", async () => {
        const { write, finished } = make();
        await write(`${vsc("A")}${vsc("P;Cwd=/a")}${vsc("B")}${vsc("P;Cwd=/b")}${vsc("C")}${vsc("D;0")}`);
        await write(`${vsc("B")}${vsc("C")}${vsc("D;0")}`);
        expect(finished.map((c) => c.cwd)).toStrictEqual(["/a", "/b"]);
    });

    it("a command before any cwd report has none", async () => {
        const { write, finished } = make();
        await write(`${vsc("B")}${vsc("D;0")}`);
        expect(finished[0].cwd).toBeUndefined();
    });
});

describe("ShellIntegrationAddon — dispose", () => {
    it("reset disposes every capability: what is held reports nothing more", async () => {
        const { write, addon } = make();
        await write(`${vsc(`P;Cwd=/a;${NONCE}`)}${vsc('EnvJson;{"A":"1"}')}`);
        const cwd = addon.capabilities.get("cwdDetection");
        const env = addon.capabilities.get("shellEnvDetection");
        const changes: unknown[] = [];
        cwd?.onDidChangeCwd((c) => changes.push(c));
        env?.onDidChangeEnv((e) => changes.push(e));
        addon.reset();
        cwd?.updateCwd("/b", false);
        env?.setEnvironment({ B: "2" }, false);
        expect(changes).toStrictEqual([]);
    });

    it("dispose removes the capabilities, then the store reports nothing more", async () => {
        const { write, addon, term } = make();
        await write(`${vsc("A")}${vsc(`P;Cwd=/a;${NONCE}`)}`);
        const { capabilities } = addon;
        const events: string[] = [];
        capabilities.onDidRemoveCapability((e) => events.push(`remove ${e.id}`));
        addon.dispose();
        expect(events).toStrictEqual(["remove commandDetection", "remove cwdDetection"]);
        capabilities.onDidAddCapability((e) => events.push(`add ${e.id}`));
        capabilities.onDidAddCommandDetectionCapability(() => events.push("integration on"));
        events.length = 0;
        capabilities.add("cwdDetection", new CwdDetectionCapability());
        capabilities.add("commandDetection", new CommandDetectionCapability(term));
        capabilities.clear();
        expect(events).toStrictEqual([]);
    });
});

describe("ShellIntegrationAddon — environment", () => {
    function envOf(addon: ShellIntegrationAddon) {
        return addon.capabilities.get("shellEnvDetection")?.env;
    }

    it("EnvJson replaces the environment; trusted with the nonce; the same values again are no change", async () => {
        const { write, addon } = make();
        const json = '{"PATH":"/bin\\x3b/usr/bin","HOME":"/h","N":1}';
        await write(vsc(`EnvJson;${json};${NONCE}`));
        const detection = addon.capabilities.get("shellEnvDetection");
        const changes: unknown[] = [];
        detection?.onDidChangeEnv((e) => changes.push(e));
        expect(envOf(addon)).toStrictEqual({ value: { PATH: "/bin;/usr/bin", HOME: "/h" }, isTrusted: true });
        await write(vsc(`EnvJson;${json}`));
        expect(changes).toStrictEqual([]);
        await write(vsc('EnvJson;{"A":"1"}'));
        expect(changes).toStrictEqual([{ value: { A: "1" }, isTrusted: false }]);
    });

    it("EnvJson that is not an object, broken or empty keeps the environment", async () => {
        const { write, addon } = make();
        await write(vsc(`EnvJson;{"A":"1"};${NONCE}`));
        await write(`${vsc("EnvJson;{broken")}${vsc("EnvJson;42")}${vsc("EnvJson;null")}${vsc("EnvJson")}`);
        expect(envOf(addon)).toStrictEqual({ value: { A: "1" }, isTrusted: true });
    });

    it("EnvSingle*: a clearing start builds a new environment, reported once at the end", async () => {
        const { write, addon } = make();
        await write(vsc(`EnvJson;{"OLD":"1"};${NONCE}`));
        const changes: unknown[] = [];
        addon.capabilities.get("shellEnvDetection")?.onDidChangeEnv((e) => changes.push(e));
        await write(
            vsc(`EnvSingleStart;1;${NONCE}`) +
                vsc(`EnvSingleEntry;PATH;/bin\\x3a/sbin;${NONCE}`) +
                vsc(`EnvSingleEntry;HOME;/h;${NONCE}`),
        );
        expect(changes).toStrictEqual([]);
        await write(vsc(`EnvSingleEnd;${NONCE}`));
        expect(changes).toStrictEqual([{ value: { PATH: "/bin:/sbin", HOME: "/h" }, isTrusted: true }]);
    });

    it("EnvSingle* without clearing updates the current one; any untrusted part, the current one included, makes it untrusted", async () => {
        const { write, addon } = make();
        await write(vsc(`EnvJson;{"A":"1","B":"2"};${NONCE}`));
        await write(
            vsc(`EnvSingleStart;0;${NONCE}`) +
                vsc("EnvSingleEntry;C;3") +
                vsc(`EnvSingleDelete;A;1;${NONCE}`) +
                vsc(`EnvSingleEnd;${NONCE}`),
        );
        expect(envOf(addon)).toStrictEqual({ value: { B: "2", C: "3" }, isTrusted: false });
        await write(
            vsc(`EnvSingleStart;0;${NONCE}`) + vsc(`EnvSingleEntry;D;4;${NONCE}`) + vsc(`EnvSingleEnd;${NONCE}`),
        );
        expect(envOf(addon)).toStrictEqual({ value: { B: "2", C: "3", D: "4" }, isTrusted: false });
    });

    it("each EnvSingle* part carries its own trust: start, delete, end; all trusted stays trusted", async () => {
        const cases = [
            [vsc("EnvSingleStart;1"), vsc(`EnvSingleEntry;A;1;${NONCE}`), vsc(`EnvSingleEnd;${NONCE}`)],
            [vsc(`EnvSingleStart;0;${NONCE}`), vsc("EnvSingleDelete;X;1"), vsc(`EnvSingleEnd;${NONCE}`)],
            [vsc(`EnvSingleStart;1;${NONCE}`), vsc(`EnvSingleEntry;A;1;${NONCE}`), vsc("EnvSingleEnd")],
        ];
        for (const parts of cases) {
            const { write, addon } = make();
            await write(vsc(`EnvJson;{"X":"1"};${NONCE}`));
            await write(parts.join(""));
            expect(envOf(addon)?.isTrusted).toBe(false);
        }
        const { write, addon } = make();
        await write(vsc(`EnvJson;{"X":"1","Y":"2"};${NONCE}`));
        await write(
            vsc(`EnvSingleStart;0;${NONCE}`) + vsc(`EnvSingleDelete;X;1;${NONCE}`) + vsc(`EnvSingleEnd;${NONCE}`),
        );
        expect(envOf(addon)).toStrictEqual({ value: { Y: "2" }, isTrusted: true });
    });

    it("an unchanged result is no change; entries outside a start, or missing a key or value, are ignored", async () => {
        const { write, addon } = make();
        await write(`${vsc("EnvSingleEntry;A;1")}${vsc("EnvSingleDelete;A;1")}${vsc("EnvSingleEnd")}`);
        expect(addon.capabilities.has("shellEnvDetection")).toBe(true);
        await write(vsc(`EnvJson;{"A":"1"};${NONCE}`));
        const changes: unknown[] = [];
        addon.capabilities.get("shellEnvDetection")?.onDidChangeEnv((e) => changes.push(e));
        await write(
            vsc(`EnvSingleStart;0;${NONCE}`) +
                vsc("EnvSingleEntry;B") +
                vsc("EnvSingleEntry") +
                vsc("EnvSingleDelete;A") +
                vsc(`EnvSingleEnd;${NONCE}`),
        );
        expect(changes).toStrictEqual([]);
        expect(envOf(addon)).toStrictEqual({ value: { A: "1" }, isTrusted: true });
    });
});
