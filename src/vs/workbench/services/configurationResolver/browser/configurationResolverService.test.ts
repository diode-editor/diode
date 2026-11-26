// Upstream's `Configuration Resolver Service` suite (configurationResolverService.test.ts): commands, inputs and
// the window state the variables are read from.

import * as paths from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { StateFileStore } from "../../../../platform/state/node/stateService.ts";
import type {
    IWorkspaceContextService,
    IWorkspaceFolder,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type {
    InputBoxOptions,
    QuickInputService,
    QuickPickOptions,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IEditorService } from "../../editor/common/editorService.ts";
import { VariableError } from "../common/configurationResolver.ts";

import { ConfigurationResolverService } from "./configurationResolverService.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/VSCode/workspaceLocation"), name: "workspaceLocation", index: 0 };

/** Upstream's `MockInputsConfigurationService` inputs. */
const INPUTS = [
    { id: "input1", type: "promptString", description: "Enterinput1", default: "default input1" },
    {
        id: "input2",
        type: "pickString",
        description: "Enterinput1",
        default: "option2",
        options: ["option1", "option2", "option3"],
    },
    { id: "input3", type: "promptString", description: "Enterinput3", default: "default input3", password: true },
    { id: "input4", type: "command", command: "command1", args: { value: "arg for command" } },
];

interface IEditorFixture {
    readonly path: string;
    readonly scheme?: string;
    readonly line?: number;
    readonly column?: number;
    readonly selections?: string[];
}

const inputs = (list: readonly unknown[] | undefined) => () => Promise.resolve(list);

function harness(options: { folders?: readonly IWorkspaceFolder[]; editor?: IEditorFixture | null } = {}) {
    const folders = options.folders ?? [FOLDER];
    const workspace = {
        getWorkspace: () => ({ id: "ws", folders }),
        getWorkspaceFolder: (uri: Uri) => folders.find((folder) => uri.fsPath.startsWith(folder.uri.fsPath)) ?? null,
    } as unknown as IWorkspaceContextService;
    const editor = options.editor === undefined ? { path: "/VSCode/workspaceLocation/file" } : options.editor;
    let selectionReads = 0;
    const editors = {
        getActiveTabEditor: () =>
            editor === null
                ? null
                : {
                      uri:
                          editor.scheme === undefined
                              ? Uri.file(editor.path)
                              : Uri.from({ scheme: editor.scheme, path: editor.path }),
                      primaryCursorLine: editor.line ?? 9,
                      primaryCursorColumn: editor.column ?? 0,
                      getSelectedTexts: () => {
                          selectionReads++;
                          return editor.selections ?? [""];
                      },
                  },
    } as unknown as IEditorService;
    const commands = new CommandRegistry();
    const commandCalls: [string, unknown][] = [];
    // Upstream's `MockCommandService`: `<id>-result`, or the `value` of the argument.
    const mockCommand = (id: string): void => {
        commands.register(id, (arg: unknown) => {
            commandCalls.push([id, structuredClone(arg)]);
            const value = (arg as { value?: unknown } | null | undefined)?.value;
            return Promise.resolve(typeof value === "string" ? value : `${id}-result`);
        });
    };
    mockCommand("command1");
    mockCommand("command2");
    const shownInputs: InputBoxOptions[] = [];
    const typed: (string | undefined)[] = [];
    const shownPicks: QuickPickOptions[] = [];
    const picked: (string | undefined)[] = [];
    const quickInput = {
        // Upstream's `TestQuickInputService`: "resolved" + prompt.
        input: vi.fn((opts: InputBoxOptions) => {
            shownInputs.push(opts);
            return Promise.resolve(typed.length > 0 ? typed.shift() : `resolved${opts.prompt ?? ""}`);
        }),
        quickPick: vi.fn((opts: QuickPickOptions): Promise<QuickPickItem | undefined> => {
            shownPicks.push(opts);
            const value = picked.length > 0 ? picked.shift() : "option3";
            return Promise.resolve(opts.items.find((item) => (item as { value?: string }).value === value));
        }),
    } as unknown as QuickInputService;
    const configuration = createTestConfigurationService({ "editor.tabSize": 3 });
    const state = new StateFileStore(undefined);
    const service = new ConfigurationResolverService(configuration, workspace, editors, commands, quickInput, state);
    /** Resolves with interaction in the `tasks` section with these inputs. */
    const ask = (
        config: unknown,
        list: readonly unknown[] | undefined = INPUTS,
        options: { folder?: IWorkspaceFolder; section?: string; variables?: Record<string, string> } = {},
    ) =>
        service.resolveWithInteraction(
            "folder" in options ? options.folder : FOLDER,
            config,
            options.section ?? "tasks",
            options.variables,
            inputs(list),
        );
    /** {@link ask} that returns the resolved configuration. */
    const askReplace = <T>(
        config: T,
        list: readonly unknown[] | undefined = INPUTS,
        folder: IWorkspaceFolder | undefined = FOLDER,
    ) => service.resolveWithInteractionReplace(folder, config, "tasks", undefined, inputs(list));
    return {
        service,
        editors,
        selectionReads: () => selectionReads,
        commands,
        commandCalls,
        shownInputs,
        typed,
        shownPicks,
        picked,
        quickInput,
        ask,
        askReplace,
    };
}

const ATTACH = {
    name: "Attach to Process",
    type: "node",
    request: "attach",
    processId: "${command:command1}",
    port: 5858,
    sourceMaps: false,
    outDir: null,
};

describe("ConfigurationResolverService — commands", () => {
    it("a single command variable: executed with the configuration, its result substituted", async () => {
        const h = harness();
        const result = await h.service.resolveWithInteractionReplace(undefined, ATTACH);
        expect(result).toStrictEqual({ ...ATTACH, processId: "command1-result" });
        expect(h.commandCalls).toStrictEqual([["command1", ATTACH]]);
    });

    it("an old style command variable: the name is an alias of the command id", async () => {
        const h = harness();
        const config = { ...ATTACH, processId: "${command:commandVariable1}" };
        const result = await h.service.resolveWithInteractionReplace(undefined, config, undefined, {
            commandVariable1: "command1",
        });
        expect(result).toStrictEqual({ ...ATTACH, processId: "command1-result" });
    });

    it("multiple new and old-style command variables: each command once", async () => {
        const h = harness();
        const config = {
            processId: "${command:commandVariable1}",
            pid: "${command:command2}",
            outDir: "src/${command:command2}",
            env: { processId: "__${command:command2}__" },
        };
        const result = await h.service.resolveWithInteractionReplace(undefined, config, undefined, {
            commandVariable1: "command1",
        });
        expect(result).toStrictEqual({
            processId: "command1-result",
            pid: "command2-result",
            outDir: "src/command2-result",
            env: { processId: "__command2-result__" },
        });
        expect(h.commandCalls.map(([id]) => id)).toStrictEqual(["command1", "command2"]);
    });

    it("a command variable that relies on resolved env vars", async () => {
        const h = harness();
        vi.stubEnv("DIODE_RESOLVER_KEY1", "Value for key1");
        const config = { processId: "${command:commandVariable1}", value: "${env:DIODE_RESOLVER_KEY1}" };
        const result = await h.service.resolveWithInteractionReplace(undefined, config, undefined, {
            commandVariable1: "command1",
        });
        vi.unstubAllEnvs();
        // The mock returns the `value` of its argument, `${env:…}`: a substituted value is resolved again.
        expect(result).toStrictEqual({ processId: "Value for key1", value: "Value for key1" });
    });

    it("the map of resolved variables is keyed by `name:arg`", async () => {
        const h = harness();
        const values = await h.service.resolveWithInteraction(FOLDER, ["${command:command1}", "${workspaceFolder}"]);
        expect(values).toStrictEqual(
            new Map([
                ["command:command1", "command1-result"],
                ["workspaceFolder", FOLDER.uri.fsPath],
            ]),
        );
    });

    it("undefined or null from the command cancels; a non-string result is an error; an unknown command too", async () => {
        const h = harness();
        h.commands.register("none", () => undefined);
        h.commands.register("null", () => Promise.resolve(null));
        h.commands.register("number", () => 42);
        expect(await h.service.resolveWithInteraction(undefined, "${command:none}")).toBeUndefined();
        expect(await h.service.resolveWithInteraction(undefined, "${command:null}")).toBeUndefined();
        await expect(h.service.resolveWithInteraction(undefined, "${command:number}")).rejects.toStrictEqual(
            new VariableError(
                "Cannot substitute command variable 'number' because command did not return a result of type string.",
            ),
        );
        await expect(h.service.resolveWithInteraction(undefined, "${command:nope}")).rejects.toThrow(
            "command 'nope' not found",
        );
        await expect(h.service.resolveWithInteraction(undefined, "${command}")).rejects.toThrow("command '' not found");
    });
});

describe("ConfigurationResolverService — inputs", () => {
    const withInput = (id: string) => ({ ...ATTACH, processId: `\${input:${id}}` });

    it("a single prompt input variable: prompt, default value, no command", async () => {
        const h = harness();
        const result = await h.askReplace(withInput("input1"));
        expect(result).toStrictEqual({ ...ATTACH, processId: "resolvedEnterinput1" });
        expect(h.shownInputs).toStrictEqual([{ prompt: "Enterinput1", value: "default input1", password: false }]);
        expect(h.commandCalls).toStrictEqual([]);
    });

    it("a single pick input variable: the default first and marked", async () => {
        const h = harness();
        const result = await h.askReplace(withInput("input2"));
        expect(result).toStrictEqual({ ...ATTACH, processId: "option3" });
        expect(h.shownPicks).toStrictEqual([
            {
                placeholder: "Enterinput1",
                items: [
                    { label: "option2", value: "option2", description: "(Default)" },
                    { label: "option1", value: "option1" },
                    { label: "option3", value: "option3" },
                ],
            },
        ]);
    });

    it("pick options as {label, value}: `label: value`; a value without a label (or an empty one) as is", async () => {
        const h = harness();
        h.picked.push("b");
        const options = [{ label: "A", value: "a" }, { value: "b" }, { label: "", value: "c" }];
        const list = [{ id: "p", type: "pickString", description: "D", options }];
        expect(await h.askReplace("${input:p}", list)).toBe("b");
        expect(h.shownPicks[0].items).toStrictEqual([
            { label: "A: a", value: "a" },
            { label: "b", value: "b" },
            { label: "c", value: "c" },
        ]);
    });

    it("a single command input variable: the command with its args", async () => {
        const h = harness();
        const result = await h.askReplace(withInput("input4"));
        expect(result).toStrictEqual({ ...ATTACH, processId: "arg for command" });
        expect(h.commandCalls).toStrictEqual([["command1", { value: "arg for command" }]]);
    });

    it("several input variables and command; a password is masked", async () => {
        const h = harness();
        const config = {
            name: "${input:input3}",
            type: "${command:command1}",
            request: "${input:input1}",
            processId: "${input:input2}",
            command: "${input:input4}",
        };
        const result = await h.askReplace(config, INPUTS, undefined);
        expect(result).toStrictEqual({
            name: "resolvedEnterinput3",
            type: "command1-result",
            request: "resolvedEnterinput1",
            processId: "option3",
            command: "arg for command",
        });
        expect(h.shownInputs[0]).toStrictEqual({ prompt: "Enterinput3", value: "default input3", password: true });
        expect(h.commandCalls).toHaveLength(2);
    });

    it("an input used several times is asked once; the inputs section is read once, and only when needed", async () => {
        const h = harness();
        const read = vi.fn(inputs(INPUTS));
        await h.service.resolveWithInteraction(FOLDER, ["${workspaceFolder}"], "tasks", undefined, read);
        expect(read).not.toHaveBeenCalled();
        const result = await h.service.resolveWithInteractionReplace(
            FOLDER,
            ["${input:input1}", "a ${input:input1}", "${input:input3}"],
            "tasks",
            undefined,
            read,
        );
        expect(result).toStrictEqual(["resolvedEnterinput1", "a resolvedEnterinput1", "resolvedEnterinput3"]);
        expect(h.shownInputs).toHaveLength(2);
        expect(read).toHaveBeenCalledTimes(1);
    });

    it("canceled input — the whole resolution is cancelled, nothing after it is asked", async () => {
        const h = harness();
        h.typed.push(undefined);
        const result = await h.askReplace(["${input:input1}", "${input:input3}"]);
        expect(result).toBeUndefined();
        expect(h.shownInputs).toHaveLength(1);
        h.picked.push(undefined);
        expect(await h.ask("${input:input2}")).toBeUndefined();
    });

    it("a command input returning nothing leaves the variable as is; a non-string is an error", async () => {
        const h = harness();
        h.commands.register("nothing", () => undefined);
        h.commands.register("null", () => null);
        h.commands.register("number", () => 1);
        const list = [
            { id: "n", type: "command", command: "nothing" },
            { id: "z", type: "command", command: "null" },
            { id: "x", type: "command", command: "number" },
        ];
        expect(await h.askReplace("${input:n}! ${input:z}?", list)).toBe("${input:n}! ${input:z}?");
        await expect(h.ask("${input:x}", list)).rejects.toStrictEqual(
            new VariableError(
                "Cannot substitute input variable 'x' because command 'number' did not return a result of type string.",
            ),
        );
    });

    it("refusals with upstream texts: no section, undefined input, bad type, missing attributes", async () => {
        const h = harness();
        const fails = async (list: readonly unknown[] | undefined, message: string): Promise<void> => {
            await expect(h.ask("${input:i}", list)).rejects.toStrictEqual(new VariableError(message));
        };
        // Without a section the inputs are not looked for (upstream's `resolveInputs`).
        const cases = [
            ["tasks", inputs(undefined)],
            ["tasks", undefined],
            [undefined, inputs([{ id: "i", type: "promptString", description: "d" }])],
        ] as const;
        for (const [section, read] of cases) {
            await expect(
                h.service.resolveWithInteraction(FOLDER, "${input:i}", section, undefined, read),
            ).rejects.toStrictEqual(
                new VariableError(
                    "Variable 'i' must be defined in an 'inputs' section of the debug or task configuration.",
                ),
            );
        }
        await fails(
            [null, { id: "other" }],
            "Undefined input variable 'i' encountered. Remove or define 'i' to continue.",
        );
        await expect(h.ask("${input}")).rejects.toStrictEqual(
            new VariableError("Undefined input variable '' encountered. Remove or define '' to continue."),
        );
        await fails(
            [{ id: "i", type: "radio" }],
            "Input variable 'i' can only be of type 'promptString', 'pickString', or 'command'.",
        );
        await fails(
            [{ id: "i", type: "promptString" }],
            "Input variable 'i' is of type 'promptString' and must include 'description'.",
        );
        await fails(
            [{ id: "i", type: "pickString", options: [] }],
            "Input variable 'i' is of type 'pickString' and must include 'description'.",
        );
        await fails(
            [{ id: "i", type: "pickString", description: "d" }],
            "Input variable 'i' is of type 'pickString' and must include 'options'.",
        );
        await fails(
            [{ id: "i", type: "pickString", description: "d", options: ["a", { label: "b" }] }],
            "Input variable 'i' is of type 'pickString' and must include 'value'.",
        );
        await fails(
            [{ id: "i", type: "pickString", description: "d", options: [null] }],
            "Input variable 'i' is of type 'pickString' and must include 'value'.",
        );
        await fails(
            [{ id: "i", type: "command" }],
            "Input variable 'i' is of type 'command' and must include 'command'.",
        );
        // The last definition of an id wins (upstream's `pop()`).
        h.typed.push("v");
        const twice = [
            { id: "i", type: "radio" },
            { id: "i", type: "promptString", description: "d" },
        ];
        expect(await h.askReplace("${input:i}", twice)).toBe("v");
    });

    it("the last value of an input is the next default (per section, not for passwords); aliases come first", async () => {
        const h = harness();
        h.typed.push("typed", "secret");
        await h.ask("${input:input1} ${input:input3}");
        h.picked.push("option3");
        await h.ask("${input:input2}");
        // A cancelled prompt forgets nothing.
        h.typed.push(undefined);
        await h.ask("${input:input1}");
        await h.ask("${input:input1} ${input:input3} ${input:input2}");
        expect(h.shownInputs.slice(3).map((opts) => opts.value)).toStrictEqual(["typed", "default input3"]);
        // The default and the remembered one are moved to the top in option order (upstream's `unshift`).
        expect(h.shownPicks[1].items.map((item) => item.label)).toStrictEqual(["option3", "option2", "option1"]);
        await h.ask("${input:input1}", INPUTS, { section: "launch" });
        expect(h.shownInputs.at(-1)?.value).toBe("default input1");
        await h.ask("${input:input1}", INPUTS, { variables: { "input:input1": "preset" } });
        expect(h.shownInputs.at(-1)?.value).toBe("preset");
    });

    it("only the five most recent values are remembered", async () => {
        const h = harness();
        const list = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, type: "promptString", description: id }));
        for (const id of ["a", "b", "c", "d", "e", "a", "f"]) {
            h.typed.push(`${id}!`);
            await h.ask(`\${input:${id}}`, list);
        }
        h.typed.push(undefined);
        await h.ask("${input:b}", list);
        expect(h.shownInputs.at(-1)?.value).toBeUndefined();
        await h.ask("${input:a}", list);
        expect(h.shownInputs.at(-1)?.value).toBe("a!");
    });

    it("inputs of resolutions running side by side are shown one after another", async () => {
        const h = harness();
        const first = Promise.withResolvers<string | undefined>();
        let shown = 0;
        vi.mocked(h.quickInput.input).mockImplementation(() => {
            shown++;
            return shown === 1 ? first.promise : Promise.resolve("second");
        });
        const a = h.ask("${input:input1}");
        const b = h.ask("${input:input3}");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(shown).toBe(1);
        first.resolve("first");
        expect((await a)?.get("input:input1")).toBe("first");
        expect((await b)?.get("input:input3")).toBe("second");
        // A failed show does not block the next ones.
        vi.mocked(h.quickInput.input).mockImplementationOnce(() => Promise.reject(new Error("boom")));
        await expect(h.ask("${input:input1}")).rejects.toThrow("boom");
        expect((await h.ask("${input:input1}"))?.size).toBe(1);
    });
});

describe("ConfigurationResolverService — the window behind the variables", () => {
    it("substitute one; uses original variable as fallback", async () => {
        const h = harness();
        expect(await h.service.resolveAsync(FOLDER, "abc ${workspaceFolder} xyz")).toBe(`abc ${FOLDER.uri.fsPath} xyz`);
        expect(await h.service.resolveAsync(FOLDER, "abc ${unknownVariable} ${command:x} xyz")).toBe(
            "abc ${unknownVariable} ${command:x} xyz",
        );
        await expect(h.service.resolveAsync(FOLDER, "${config}")).rejects.toBeInstanceOf(VariableError);
    });

    it("substitution in object key", async () => {
        const h = harness();
        const config = {
            name: "Test",
            mappings: { pos1: "value1", "${workspaceFolder}/test1": "${workspaceFolder}/test2" },
        };
        const root = FOLDER.uri.fsPath;
        expect(await h.service.resolveWithInteractionReplace(FOLDER, config, "tasks")).toStrictEqual({
            name: "Test",
            mappings: { pos1: "value1", [`${root}/test1`]: `${root}/test2` },
        });
    });

    it("the active file editor: file, its folder, 1-based line and column, the primary selection", () => {
        const h = harness({
            editor: { path: "/VSCode/workspaceLocation/src/a.ts", line: 9, column: 4, selections: ["sel", "other"] },
        });
        expect(
            h.service.resolveWithValues(
                FOLDER,
                "${file}|${fileWorkspaceFolder}|${lineNumber}:${columnNumber}|${selectedText}",
                new Map(),
            ),
        ).toBe(`${Uri.file("/VSCode/workspaceLocation/src/a.ts").fsPath}|${FOLDER.uri.fsPath}|10:5|sel`);
    });

    it("an editor of another scheme is no file; no editor is none either", () => {
        for (const editor of [{ path: "/x", scheme: "untitled" }, null]) {
            const h = harness({ editor });
            expect(() => h.service.resolveWithValues(FOLDER, "${file}")).toThrow("Please open an editor.");
            expect(() => h.service.resolveWithValues(FOLDER, "${lineNumber}")).toThrow("have a line selected");
            expect(() => h.service.resolveWithValues(FOLDER, "${columnNumber}")).toThrow("have a column selected");
            expect(() => h.service.resolveWithValues(FOLDER, "${selectedText}")).toThrow("have some text selected");
        }
        const outside = harness({ editor: { path: "/elsewhere/a.ts" } });
        expect(() => outside.service.resolveWithValues(FOLDER, "${fileWorkspaceFolder}")).toThrow(
            "can not find workspace folder of 'a.ts'",
        );
    });

    it("folders by name and their count; settings; environment, home, cwd, executable", () => {
        const other: IWorkspaceFolder = { uri: Uri.file("/other"), name: "other", index: 1 };
        const h = harness({ folders: [FOLDER, other] });
        expect(h.service.resolveWithValues(FOLDER, "${workspaceFolder:other}")).toBe(other.uri.fsPath);
        expect(() => h.service.resolveWithValues(FOLDER, "${workspaceFolder:nope}")).toThrow("No such folder 'nope'");
        expect(() => h.service.resolveWithValues(undefined, "${workspaceFolder}")).toThrow("multi folder workspace");
        expect(h.service.resolveWithValues(FOLDER, "${config:editor.tabSize}")).toBe("3");
        vi.stubEnv("DIODE_RESOLVER_VAR", "v");
        vi.stubEnv("HOME", "/home/me");
        expect(h.service.resolveWithValues(undefined, "${env:DIODE_RESOLVER_VAR}|${userHome}|${cwd}")).toBe(
            `v|/home/me|${process.cwd()}`,
        );
        vi.stubEnv("HOME", undefined);
        vi.stubEnv("USERPROFILE", "C:\\Users\\me");
        expect(h.service.resolveWithValues(undefined, "${userHome}")).toBe("C:\\Users\\me");
        vi.unstubAllEnvs();
        expect(h.service.resolveWithValues(undefined, "${execPath}|${execInstallFolder}")).toBe(
            `${process.execPath}|${paths.dirname(process.execPath)}`,
        );
    });

    it("extension folders once the extension host has set its lookup", () => {
        const h = harness();
        const resolve = () => h.service.resolveWithValues(FOLDER, "${extensionInstallFolder:pub.ext}");
        expect(resolve).toThrow("the extension pub.ext is not installed");
        const extension = { id: "pub.ext", location: "/ext/pub.ext" } as IExtension;
        h.service.setExtensions((id) => (id === extension.id ? extension : undefined));
        expect(resolve()).toBe("/ext/pub.ext");
        expect(() => h.service.resolveWithValues(FOLDER, "${extensionInstallFolder:x.y}")).toThrow("not installed");
    });

    it("the window is read only when a variable needs it, the selection only for ${selectedText}", () => {
        const h = harness();
        const getActiveTabEditor = vi.spyOn(h.editors, "getActiveTabEditor");
        expect(h.service.resolveWithValues(FOLDER, "${input:a} plain", new Map([["input:a", "A"]]))).toBe("A plain");
        expect(getActiveTabEditor).not.toHaveBeenCalled();
        h.service.resolveWithValues(FOLDER, "${file} ${lineNumber}");
        expect(getActiveTabEditor).toHaveBeenCalledTimes(1);
        expect(h.selectionReads()).toBe(0);
    });
});
