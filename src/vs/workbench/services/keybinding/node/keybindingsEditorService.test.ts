import * as fs from "node:fs";
import * as path from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IKeybindingEntrySnapshot } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    chordsEqual,
    KeybindingRegistry,
    parseChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";

import { KeybindingsEditorService } from "./keybindingsEditorService.ts";

let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-kb-editor-" });
});

afterEach(() => {
    ws.dispose();
});

/** A "file inside a file" path — writing to it is guaranteed to fail. */
function unwritableEnvironment(): { keybindingsResource: string } {
    const blocker = ws.path("blocker");
    fs.writeFileSync(blocker, "", "utf-8");
    return { keybindingsResource: path.join(blocker, "keybindings.json") };
}

interface IHarness {
    registry: KeybindingRegistry;
    service: KeybindingsEditorService;
    file: string;
    entryOf(commandId: string, chordSpec?: string): IKeybindingEntrySnapshot;
    fileContent(): string;
    rules(): { key?: string; command: string; when?: string; args?: unknown }[];
    resolves(chordSpec: string): string | undefined;
}

function makeHarness(fileContent?: string): IHarness {
    const file = ws.path("User/keybindings.json");
    if (fileContent !== undefined) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, fileContent, "utf-8");
    }
    const registry = new KeybindingRegistry();
    const service = new KeybindingsEditorService(registry, { keybindingsResource: file }, NULL_LOG_SERVICE);
    return {
        registry,
        service,
        file,
        entryOf: (commandId, chordSpec) => {
            const entry = registry
                .listBindings()
                .find(
                    (candidate) =>
                        candidate.commandId === commandId &&
                        (chordSpec === undefined || chordsEqual(candidate.chord, parseChord(chordSpec))),
                );
            expect(entry, `entry ${commandId} not found in the registry`).toBeDefined();
            return entry!;
        },
        fileContent: () => fs.readFileSync(file, "utf-8"),
        rules: () =>
            parseJsonc(fs.readFileSync(file, "utf-8"), [], { allowTrailingComma: true }) as {
                key?: string;
                command: string;
                when?: string;
                args?: unknown;
            }[],
        resolves: (chordSpec) => {
            const chord = parseChord(chordSpec);
            let result: string | undefined;
            for (const part of chord) {
                const res = registry.resolveKey({ ...part });
                result = res.kind === "command" ? res.commandId : undefined;
            }
            return result;
        },
    };
}

describe("applyUserKeybindings (bootstrap)", () => {
    it("a rule adds a user binding that overrides the default", () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "user.custom" }]);

        expect(h.resolves("ctrl+s")).toBe("user.custom");
        expect(h.entryOf("user.custom").source).toBe("user");
    });

    it("'-command' with a key removes that binding, without a key removes all", () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        h.registry.register(parseChord("ctrl+shift+s"), "test.save");

        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(h.resolves("ctrl+s")).toBeUndefined();
        expect(h.resolves("ctrl+shift+s")).toBe("test.save");

        h.service.applyUserKeybindings([{ key: "", command: "-test.save" }]);
        expect(h.resolves("ctrl+shift+s")).toBeUndefined();
    });

    it("rule args reach the registry and resolution (binding with prefill)", () => {
        const h = makeHarness();

        h.service.applyUserKeybindings([{ key: "f6", command: "workbench.action.quickOpen", args: "src/" }]);

        const res = h.registry.resolveKey({ ...parseChord("f6")[0] });
        expect(res).toEqual({
            kind: "command",
            commandId: "workbench.action.quickOpen",
            when: undefined,
            args: "src/",
        });
    });
});

describe("defineKeybinding", () => {
    it("replacing a default: the file gets a 'new rule + unbind' pair, the registry updates at once", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save", "textViewFocus");

        const result = await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));

        expect(result.ok).toBe(true);
        const content = h.fileContent();
        expect(content).toContain('"key": "f6"');
        expect(content).toContain('"command": "test.save"');
        expect(content).toContain('"command": "-test.save"');
        expect(content).toContain('"key": "ctrl+s"');
        expect(content).toContain('"when": "textViewFocus"');
        expect(h.resolves("ctrl+s")).toBeUndefined();
        expect(h.entryOf("test.save", "f6").source).toBe("user");
    });

    it("replacing a user rule rewrites it without adding unbind", async () => {
        const h = makeHarness();
        h.service.applyUserKeybindings([{ key: "f6", command: "my.command" }]);

        const result = await h.service.defineKeybinding("my.command", parseChord("f7"), h.entryOf("my.command"));

        expect(result.ok).toBe(true);
        const content = h.fileContent();
        expect(content).toContain('"key": "f7"');
        expect(content).not.toContain('"key": "f6"');
        expect(content).not.toContain("-my.command");
        expect(h.resolves("f7")).toBe("my.command");
        expect(h.resolves("f6")).toBeUndefined();
    });

    it("rebinding a user rule keeps its args in the file and in the registry", async () => {
        const h = makeHarness();
        h.service.applyUserKeybindings([{ key: "f6", command: "my.command", args: { text: "src/" } }]);

        const result = await h.service.defineKeybinding("my.command", parseChord("f7"), h.entryOf("my.command"));

        expect(result.ok).toBe(true);
        const written = h.rules();
        expect(written).toHaveLength(1);
        expect(written[0]).toMatchObject({ key: "f7", command: "my.command", args: { text: "src/" } });
        const res = h.registry.resolveKey({ ...parseChord("f7")[0] });
        expect(res.kind === "command" && res.args).toEqual({ text: "src/" });
    });

    it("without previous, adds another binding", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.defineKeybinding("test.save", parseChord("f6"));

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("-test.save");
        expect(h.resolves("ctrl+s")).toBe("test.save");
        expect(h.resolves("f6")).toBe("test.save");
    });

    it("editing an existing file keeps comments of neighbouring rules", async () => {
        const h = makeHarness(`[
    // pinned by hand
    { "key": "ctrl+h", "command": "hand.made" },
    { "key": "f6", "command": "other.command" },
]
`);
        h.service.applyUserKeybindings([
            { key: "ctrl+h", command: "hand.made" },
            { key: "f6", command: "other.command" },
        ]);

        await h.service.defineKeybinding("other.command", parseChord("f9"), h.entryOf("other.command"));

        const content = h.fileContent();
        // The replaced rule's comment goes with it — it annotated that rule.
        expect(content).toContain("// pinned by hand");
        expect(content).toContain('"key": "ctrl+h"');
        expect(content).toContain('"key": "f9"');
        expect(content).not.toContain('"key": "f6"');
    });
});

describe("removeKeybinding", () => {
    it("a default is removed by an unbind rule in the file and from the registry", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.removeKeybinding(h.entryOf("test.save"));

        expect(result.ok).toBe(true);
        expect(h.fileContent()).toContain('"command": "-test.save"');
        expect(h.resolves("ctrl+s")).toBeUndefined();
    });

    it("a user rule is deleted from the file without unbind", async () => {
        const h = makeHarness();
        h.service.applyUserKeybindings([{ key: "f6", command: "my.command" }]);

        const result = await h.service.removeKeybinding(h.entryOf("my.command"));

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("my.command");
        expect(h.resolves("f6")).toBeUndefined();
    });
});

describe("resetKeybinding", () => {
    it("restores a default removed by an override in the same session", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));

        const result = await h.service.resetKeybinding("test.save");

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("test.save");
        expect(h.resolves("ctrl+s")).toBe("test.save");
        expect(h.resolves("f6")).toBeUndefined();
        expect(h.entryOf("test.save").source).toBe("default");
    });

    it("restores a default removed by an unbind rule at bootstrap", async () => {
        const h = makeHarness(`[
    { "key": "ctrl+s", "command": "-test.save" }
]
`);
        h.registry.register(parseChord("ctrl+s"), "test.save");
        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(h.resolves("ctrl+s")).toBeUndefined();

        const result = await h.service.resetKeybinding("test.save");

        expect(result.ok).toBe(true);
        expect(h.fileContent()).not.toContain("-test.save");
        expect(h.resolves("ctrl+s")).toBe("test.save");
    });

    it("an entry restored after reset keeps its args", async () => {
        const h = makeHarness(`[
    { "key": "f6", "command": "-ext.withArgs" }
]
`);
        h.registry.register(parseChord("f6"), "ext.withArgs", undefined, "extension", { verbose: true });
        h.service.applyUserKeybindings([{ key: "f6", command: "-ext.withArgs" }]);
        expect(h.resolves("f6")).toBeUndefined();

        const result = await h.service.resetKeybinding("ext.withArgs");

        expect(result.ok).toBe(true);
        const res = h.registry.resolveKey({ ...parseChord("f6")[0] });
        expect(res.kind === "command" && res.args).toEqual({ verbose: true });
    });

    it("a restored default returns to its previous priority, not to the end of the registry", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("escape"), "test.first");
        h.registry.register(parseChord("escape"), "test.second");
        await h.service.removeKeybinding(h.entryOf("test.second"));
        expect(h.resolves("escape")).toBe("test.first");

        await h.service.resetKeybinding("test.second");

        expect(h.resolves("escape")).toBe("test.second");
        expect(h.registry.listBindings().map((entry) => entry.commandId)).toEqual(["test.first", "test.second"]);
    });

    it("a user binding beats an extension binding even if the extension layer arrives later", async () => {
        const h = makeHarness();
        await h.service.defineKeybinding("user.cmd", parseChord("f6"));
        h.registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("f6") }]);

        expect(h.resolves("f6")).toBe("user.cmd");
    });

    it("reset of a command without user rules is a no-op with ok", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.resetKeybinding("test.save");

        expect(result.ok).toBe(true);
        expect(h.resolves("ctrl+s")).toBe("test.save");
    });
});

describe("hasUserModifications", () => {
    it("false without edits, true after define and bootstrap unbind, false after reset", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        expect(h.service.hasUserModifications("test.save")).toBe(false);

        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));
        expect(h.service.hasUserModifications("test.save")).toBe(true);

        await h.service.resetKeybinding("test.save");
        expect(h.service.hasUserModifications("test.save")).toBe(false);

        h.service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(h.service.hasUserModifications("test.save")).toBe(true);
    });

    it("a rule of another command does not count as an edit of this one", () => {
        const h = makeHarness();
        h.service.applyUserKeybindings([
            { key: "f6", command: "other.cmd" },
            { key: "f7", command: "-other.cmd" },
        ]);
        expect(h.service.hasUserModifications("test.save")).toBe(false);
        expect(h.service.hasUserModifications("other.cmd")).toBe(true);
    });

    it("true when the file has a rule for the command", async () => {
        const h = makeHarness();
        await h.service.defineKeybinding("brand.new", parseChord("f6"));
        expect(h.service.hasUserModifications("brand.new")).toBe(true);
    });

    it("true when the file only has a removal of the command", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        await h.service.removeKeybinding(h.entryOf("test.save"));
        expect(h.service.hasUserModifications("test.save")).toBe(true);
    });
});

describe("outcomes and events", () => {
    it("removeKeybinding and resetKeybinding on a write error fail without touching the registry", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        const service = new KeybindingsEditorService(registry, unwritableEnvironment(), NULL_LOG_SERVICE);
        const entry = registry.listBindings()[0];

        expect((await service.removeKeybinding(entry)).ok).toBe(false);
        expect((await service.resetKeybinding("test.save")).ok).toBe(false);
        expect(registry.listBindings()).toHaveLength(1);
    });

    it("a write error is returned as the result, the registry is untouched", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        const blocker = ws.path("blocker");
        fs.writeFileSync(blocker, "", "utf-8");
        const service = new KeybindingsEditorService(
            registry,
            { keybindingsResource: path.join(blocker, "keybindings.json") },
            NULL_LOG_SERVICE,
        );

        const result = await service.defineKeybinding("test.save", parseChord("f6"));

        expect(result.ok).toBe(false);
        expect(registry.listBindings()).toHaveLength(1);
    });

    it("a successful mutation emits onDidChange, unsubscribing works", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        let fired = 0;
        const subscription = h.service.onDidChange(() => {
            fired++;
        });

        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));
        expect(fired).toBe(1);

        subscription.dispose();
        await h.service.resetKeybinding("test.save");
        expect(fired).toBe(1);
    });

    it("a failed mutation does not emit onDidChange", async () => {
        const registry = new KeybindingRegistry();
        const service = new KeybindingsEditorService(registry, unwritableEnvironment(), NULL_LOG_SERVICE);
        let fired = 0;
        service.onDidChange(() => {
            fired++;
        });

        await service.defineKeybinding("x", parseChord("f6"));

        expect(fired).toBe(0);
    });

    it("remove and reset emit onDidChange too", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        let fired = 0;
        h.service.onDidChange(() => {
            fired++;
        });

        await h.service.removeKeybinding(h.entryOf("test.save"));
        expect(fired).toBe(1);

        await h.service.resetKeybinding("test.save");
        expect(fired).toBe(2);
    });
});

describe("rule selection and file writing — subtleties", () => {
    it("define without previous over a non-empty file leaves existing rules alone", async () => {
        const h = makeHarness(`[
    { "key": "ctrl+h", "command": "other.command" }
]
`);
        h.registry.register(parseChord("ctrl+s"), "test.save");

        const result = await h.service.defineKeybinding("test.save", parseChord("f6"));

        expect(result.ok).toBe(true);
        const rules = h.rules();
        expect(rules.map((r) => r.command).sort()).toEqual(["other.command", "test.save"]);
    });

    it("define into a nonexistent file yields exactly one valid rule", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");

        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save"));

        const rules = h.rules();
        expect(Array.isArray(rules)).toBe(true);
        expect(rules).toHaveLength(2);
        expect(rules.map((r) => r.command).sort()).toEqual(["-test.save", "test.save"]);
        // The file ends with the closing array bracket — the starting content was "",
        // not junk (otherwise modify would leave a tail after `]`).
        expect(h.fileContent().trimEnd().endsWith("]")).toBe(true);
    });

    it("matchesUserRule removes only the exactly matching rule: other command/key/when stay", async () => {
        // Four user rules, each differing from the target {save, ctrl+s, listFocus} in exactly one field.
        const h = makeHarness(`[
    { "key": "ctrl+s", "command": "save", "when": "listFocus" },
    { "key": "ctrl+s", "command": "other", "when": "listFocus" },
    { "key": "ctrl+x", "command": "save", "when": "listFocus" },
    { "key": "ctrl+s", "command": "save", "when": "editorFocus" }
]
`);
        h.service.applyUserKeybindings([
            { key: "ctrl+s", command: "save", when: "listFocus" },
            { key: "ctrl+s", command: "other", when: "listFocus" },
            { key: "ctrl+x", command: "save", when: "listFocus" },
            { key: "ctrl+s", command: "save", when: "editorFocus" },
        ]);
        const target = h.registry
            .listBindings()
            .find(
                (b) => b.commandId === "save" && b.when === "listFocus" && chordsEqual(b.chord, parseChord("ctrl+s")),
            )!;

        await h.service.removeKeybinding(target);

        const rules = h.rules();
        expect(rules).toHaveLength(3);
        expect(rules.some((r) => r.command === "save" && r.key === "ctrl+s" && r.when === "listFocus")).toBe(false);
        expect(rules.some((r) => r.command === "other")).toBe(true);
        expect(rules.some((r) => r.key === "ctrl+x")).toBe(true);
        expect(rules.some((r) => r.when === "editorFocus")).toBe(true);
    });

    it("remove removes ONLY the user rule with a matching when (matchesUserRule is when-sensitive)", async () => {
        const h = makeHarness(`[
    { "key": "f6", "command": "dup.cmd", "when": "listFocus" },
    { "key": "f6", "command": "dup.cmd", "when": "textViewFocus" }
]
`);
        h.service.applyUserKeybindings([
            { key: "f6", command: "dup.cmd", when: "listFocus" },
            { key: "f6", command: "dup.cmd", when: "textViewFocus" },
        ]);

        const listFocusEntry = h.registry
            .listBindings()
            .find((b) => b.commandId === "dup.cmd" && b.when === "listFocus")!;
        await h.service.removeKeybinding(listFocusEntry);

        const remaining = h.rules().filter((r) => r.command === "dup.cmd");
        expect(remaining).toHaveLength(1);
        expect(remaining[0].when).toBe("textViewFocus");
    });

    it("removing a user rule without when does not affect a user rule with when on the same combination", async () => {
        const h = makeHarness(`[
    { "key": "f6", "command": "dup.cmd" },
    { "key": "f6", "command": "dup.cmd", "when": "listFocus" }
]
`);
        h.service.applyUserKeybindings([
            { key: "f6", command: "dup.cmd" },
            { key: "f6", command: "dup.cmd", when: "listFocus" },
        ]);

        const noWhenEntry = h.registry.listBindings().find((b) => b.commandId === "dup.cmd" && b.when === undefined)!;
        await h.service.removeKeybinding(noWhenEntry);

        const remaining = h.rules().filter((r) => r.command === "dup.cmd");
        expect(remaining).toHaveLength(1);
        expect(remaining[0].when).toBe("listFocus");
    });

    it("a failed reset (write error) does NOT touch the registry: early exit on !result.ok", async () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+s"), "test.save");
        const blocker = ws.path("blocker");
        fs.writeFileSync(blocker, "", "utf-8");
        const service = new KeybindingsEditorService(
            registry,
            { keybindingsResource: path.join(blocker, "keybindings.json") },
            NULL_LOG_SERVICE,
        );
        // A bootstrap unbind of a default does not write the file.
        service.applyUserKeybindings([{ key: "ctrl+s", command: "-test.save" }]);
        expect(registry.getKeybindingForCommand("test.save")).toBeUndefined();

        const result = await service.resetKeybinding("test.save");

        expect(result.ok).toBe(false);
        expect(registry.getKeybindingForCommand("test.save")).toBeUndefined();
    });

    it("removing the only user binding clears the ledger (added is filtered, not moved to removedDefaults)", async () => {
        const h = makeHarness(`[{ "key": "f6", "command": "my.cmd" }]\n`);
        h.service.applyUserKeybindings([{ key: "f6", command: "my.cmd" }]);
        expect(h.service.hasUserModifications("my.cmd")).toBe(true);

        await h.service.removeKeybinding(h.entryOf("my.cmd", "f6"));

        expect(h.service.hasUserModifications("my.cmd")).toBe(false);
    });

    it("removing one of two user bindings keeps the other alive, and reset removes it", async () => {
        const h = makeHarness(`[
    { "key": "f6", "command": "dup.cmd" },
    { "key": "f7", "command": "dup.cmd" }
]
`);
        h.service.applyUserKeybindings([
            { key: "f6", command: "dup.cmd" },
            { key: "f7", command: "dup.cmd" },
        ]);

        await h.service.removeKeybinding(h.entryOf("dup.cmd", "f6"));
        expect(h.resolves("f7")).toBe("dup.cmd");

        await h.service.resetKeybinding("dup.cmd");
        expect(h.resolves("f7")).toBeUndefined();
    });

    it("reset removes both the direct rule and -command of the same command, leaves others alone", async () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "test.save");
        h.registry.register(parseChord("ctrl+h"), "other.command");
        await h.service.defineKeybinding("test.save", parseChord("f6"), h.entryOf("test.save")); // add + -test.save
        await h.service.defineKeybinding("other.command", parseChord("f7"), h.entryOf("other.command"));

        await h.service.resetKeybinding("test.save");

        const commands = h.rules().map((r) => r.command);
        expect(commands).not.toContain("test.save");
        expect(commands).not.toContain("-test.save");
        expect(commands).toContain("other.command");
        expect(commands).toContain("-other.command");
    });
});
