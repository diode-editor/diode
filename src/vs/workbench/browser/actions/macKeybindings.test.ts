import { describe, expect, it } from "vitest";

import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { requiresExtendedKeys } from "../../../platform/keybinding/common/keybindingPortability.ts";
import {
    type IKeybindingEntrySnapshot,
    type Keybinding,
    KeybindingRegistry,
    parseChord,
    parseKeybinding,
    serializeChord,
} from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { macKeysLevel, type MacKeysRung } from "../../../platform/keybinding/common/macKeys.ts";

import { builtinActions } from "./builtinActions.ts";
import { MAC_KEYBINDING_DELTAS, type MacKeybindingDelta, withMacKeybindings } from "./macKeybindings.ts";

const noopRun = (): void => undefined;

function action(partial: Partial<CommandAction> & { id: string }): CommandAction {
    return { title: partial.id, run: noopRun, ...partial };
}

/** Все дефолтные бинды — так, как их регистрирует WorkbenchComponent. */
function registerBuiltins(): KeybindingRegistry {
    const keybindings = new KeybindingRegistry();
    const commands = new CommandRegistry();
    const accessor = {} as ServiceAccessor; // enablement резолвится только при исполнении
    for (const builtin of builtinActions) registerAction(commands, keybindings, accessor, withMacKeybindings(builtin));
    return keybindings;
}

interface Environment {
    readonly name: string;
    readonly tier: "legacy" | "csi-u" | "kitty";
    readonly rung?: MacKeysRung;
    readonly tmux?: boolean;
}

const ENVIRONMENTS: readonly Environment[] = [
    { name: "pc legacy", tier: "legacy" },
    { name: "pc csi-u", tier: "csi-u" },
    { name: "pc kitty", tier: "kitty" },
    { name: "mac-legacy (Terminal.app)", tier: "legacy", rung: "legacy" },
    { name: "mac-legacy (tmux)", tier: "legacy", rung: "legacy", tmux: true },
    { name: "mac-extended (tmux + extended-keys)", tier: "csi-u", rung: "extended", tmux: true },
    { name: "mac-cmd (kitty)", tier: "kitty", rung: "cmd" },
];

/** Представительные фокус-контексты: у биндов с разным фокусом when взаимоисключающие сами. */
const FOCUS_CONTEXTS: readonly Readonly<Record<string, boolean>>[] = [
    {},
    { textViewFocus: true, textInputFocus: true, editorGroupHasEditors: true, editorTabsMultiple: true },
    { inputWidgetFocus: true },
    { listFocus: true },
];

function contextFor(env: Environment, focus: Readonly<Record<string, boolean>>): ContextKeyService {
    const contextKeys = new ContextKeyService();
    const os = env.rung === undefined ? "linux" : "mac";
    contextKeys.set("tier", env.tier);
    contextKeys.set("os", os);
    contextKeys.set("isMac", os === "mac");
    contextKeys.set("isLinux", os === "linux");
    contextKeys.set("cap_extendedKeys", env.tier !== "legacy");
    contextKeys.set("cap_super", env.rung === "cmd");
    contextKeys.set("macKeys", macKeysLevel(env.rung));
    contextKeys.set("mode_tmux", env.tmux === true);
    for (const [key, value] of Object.entries(focus)) contextKeys.setRaw(key, value);
    return contextKeys;
}

function activeEntries(
    registry: KeybindingRegistry,
    contextKeys: ContextKeyService,
): readonly IKeybindingEntrySnapshot[] {
    return registry.listBindings().filter((entry) => entry.when === undefined || contextKeys.evaluate(entry.when));
}

// Ловушки мака (калибровка по перечню fresh): доедет ли часть на mac-legacy.
const LETTER = /^[a-z]$/i;

function isMacTrap(part: Keybinding): boolean {
    // Option+буква на интернациональной раскладке — это символ (@ [ ] { }).
    if (part.altKey && !part.ctrlKey && !part.metaKey && LETTER.test(part.key)) return true;
    // Ctrl+←/→ забирает Mission Control.
    if (part.ctrlKey && (part.key === "ArrowLeft" || part.key === "ArrowRight")) return true;
    // Home/End в мак-терминалах скроллят буфер.
    return part.key === "Home" || part.key === "End";
}

function deliverableOnMacLegacy(chord: readonly Keybinding[]): boolean {
    return !requiresExtendedKeys([...chord]) && !chord.some(isMacTrap);
}

describe("withMacKeybindings", () => {
    const deltas = (delta: MacKeybindingDelta): ReadonlyMap<string, MacKeybindingDelta> =>
        new Map([[delta.command, delta]]);

    it("команда без дельты возвращается как есть", () => {
        const plain = action({ id: "x", keybinding: parseKeybinding("ctrl+x") });
        expect(withMacKeybindings(plain, new Map())).toBe(plain);
    });

    it("pcOnly получает «не мак», мак-бинды — «рунг ≥ from»; порядок и прочие поля сохраняются", () => {
        const result = withMacKeybindings(
            action({
                id: "cursorWordLeft",
                keybinding: parseKeybinding("ctrl+left"),
                keybindings: [
                    parseChord("ctrl+k left"),
                    { keys: parseKeybinding("alt+left"), when: "tier == 'legacy'" },
                ],
                when: "textViewFocus",
            }),
            deltas({ command: "cursorWordLeft", pcOnly: ["ctrl+left"], mac: [{ keys: "alt+left", from: "legacy" }] }),
        );
        expect(result.keybinding).toBeUndefined();
        expect(result.when).toBe("textViewFocus");
        expect(
            result.keybindings?.map((entry) => {
                const conditional = entry as { keys: Keybinding[]; when?: string };
                return [serializeChord(conditional.keys), conditional.when];
            }),
        ).toEqual([
            ["ctrl+left", "macKeys < 1"],
            ["ctrl+k left", undefined],
            ["alt+left", "tier == 'legacy'"],
            ["alt+left", "macKeys >= 1"],
        ]);
    });

    it("pcOnly сверяется с объявлением, включая mod и условие", () => {
        const result = withMacKeybindings(
            action({ id: "a", keybinding: { keys: parseKeybinding("mod+a"), when: "listFocus" } }),
            deltas({ command: "a", pcOnly: ["mod+a"] }),
        );
        expect(result.keybindings).toEqual([
            { keys: [parseKeybinding("mod+a")], when: "(listFocus) && (macKeys < 1)" },
        ]);
    });

    it("pcOnly, которого нет среди биндов, — ошибка таблицы", () => {
        expect(() => withMacKeybindings(action({ id: "a" }), deltas({ command: "a", pcOnly: ["ctrl+q"] }))).toThrow(
            /a: pcOnly ctrl\+q/,
        );
    });
});

describe("таблица мак-дельт", () => {
    it("содержимое таблицы — пользовательский контракт (эталон vscode)", () => {
        const flat = MAC_KEYBINDING_DELTAS.map((delta) =>
            [
                delta.command,
                (delta.pcOnly ?? []).map((spec) => `-${spec}`).join(" "),
                (delta.mac ?? []).map(({ keys, from }) => `${keys}@${from}`).join(" "),
            ]
                .filter((part) => part !== "")
                .join(" | "),
        );
        expect(flat).toEqual([
            "cursorWordLeft | -ctrl+left | alt+left@legacy",
            "cursorWordRight | -ctrl+right | alt+right@legacy",
            "cursorWordLeftSelect | -ctrl+shift+left | alt+shift+left@legacy",
            "cursorWordRightSelect | -ctrl+shift+right | alt+shift+right@legacy",
            "input.cursorWordLeft | -ctrl+left | alt+left@legacy",
            "input.cursorWordRight | -ctrl+right | alt+right@legacy",
            "deleteWordLeft | -ctrl+backspace | alt+backspace@legacy",
            "deleteWordRight | -ctrl+delete | alt+delete@legacy",
            "input.deleteWordLeft | -ctrl+backspace | alt+backspace@legacy",
            "input.deleteWordRight | -ctrl+delete | alt+delete@legacy",
            "cursorLineStart | ctrl+a@legacy",
            "cursorLineEnd | ctrl+e@legacy",
            "editor.action.selectAll | -ctrl+a | meta+a@cmd",
            "cursorHome | meta+left@cmd",
            "cursorEnd | meta+right@cmd",
            "cursorHomeSelect | meta+shift+left@cmd",
            "cursorEndSelect | meta+shift+right@cmd",
            "deleteAllLeft | meta+backspace@cmd",
            "cursorTop | meta+up@cmd",
            "cursorBottom | meta+down@cmd",
            "cursorTopSelect | meta+shift+up@cmd",
            "cursorBottomSelect | meta+shift+down@cmd",
            "workbench.action.nextEditor | meta+alt+right@cmd meta+shift+]@cmd",
            "workbench.action.previousEditor | meta+alt+left@cmd meta+shift+[@cmd",
        ]);
    });

    it("каждая дельта ссылается на встроенную команду, и каждая накладывается без ошибок", () => {
        const ids = new Set(builtinActions.map((builtin) => builtin.id));
        expect(MAC_KEYBINDING_DELTAS.map((delta) => delta.command).filter((id) => !ids.has(id))).toEqual([]);
        expect(() => builtinActions.map((builtin) => withMacKeybindings(builtin))).not.toThrow();
        expect(new Set(MAC_KEYBINDING_DELTAS.map((delta) => delta.command)).size).toBe(MAC_KEYBINDING_DELTAS.length);
    });

    it("ни одна мак-дельта не ставит alt+<буква>, ctrl+←/→ или Cmd+C/V/X", () => {
        const offending = MAC_KEYBINDING_DELTAS.flatMap((delta) =>
            (delta.mac ?? [])
                .filter(({ keys }) => {
                    const chord = parseChord(keys);
                    const clipboard = chord.some((part) => part.metaKey && ["c", "v", "x"].includes(part.key));
                    return (
                        clipboard || chord.some((part) => isMacTrap(part) && part.key !== "Home" && part.key !== "End")
                    );
                })
                .map(({ keys }) => `${delta.command}: ${keys}`),
        );
        expect(offending).toEqual([]);
    });

    it("мак-бинд объявлен на самом низком рунге, где доезжает: legacy-комбинации не заперты выше", () => {
        const tooHigh = MAC_KEYBINDING_DELTAS.flatMap((delta) =>
            (delta.mac ?? [])
                .filter(({ keys, from }) => from !== "legacy" && deliverableOnMacLegacy(parseChord(keys)))
                .map(({ keys }) => `${delta.command}: ${keys}`),
        );
        expect(tooHigh).toEqual([]);
    });
});

describe("инвариант: внутри семейства условия взаимоисключающие", () => {
    // Резолвер идёт с конца: если pc-бинд и мак-бинд сматчились разом, молча
    // победит зарегистрированный позже. Ищем такие пары во всей матрице.
    const registry = registerBuiltins();

    it.each(ENVIRONMENTS.map((env) => [env.name, env] as const))("%s", (_name, env) => {
        const conflicts = new Set<string>();
        for (const focus of FOCUS_CONTEXTS) {
            const byChord = new Map<string, IKeybindingEntrySnapshot[]>();
            for (const entry of activeEntries(registry, contextFor(env, focus))) {
                const key = serializeChord(entry.chord);
                byChord.set(key, [...(byChord.get(key) ?? []), entry]);
            }
            for (const [chord, entries] of byChord) {
                const involvesMacFamily = entries.some((entry) => entry.when?.includes("macKeys") === true);
                const commands = new Set(entries.map((entry) => entry.commandId));
                if (involvesMacFamily && commands.size > 1)
                    conflicts.add(`${chord}: ${[...commands].sort().join(" / ")}`);
            }
        }
        expect([...conflicts]).toEqual([]);
    });
});

describe("mod разворачивается по рунгу", () => {
    const registry = registerBuiltins();
    const saveChords = (env: Environment): string[] =>
        activeEntries(registry, contextFor(env, {}))
            .filter((entry) => entry.commandId === "workbench.action.files.save")
            .map((entry) => serializeChord(entry.chord));

    it.each<[string, Environment, string[]]>([
        ["pc", { name: "pc", tier: "kitty" }, ["ctrl+s", "ctrl+k s"]],
        ["mac-legacy", { name: "mac", tier: "legacy", rung: "legacy" }, ["ctrl+s", "ctrl+k s"]],
        ["mac-cmd", { name: "mac", tier: "kitty", rung: "cmd" }, ["meta+s", "meta+k s"]],
        [
            "kitty + tmux ⇒ Cmd выключен",
            { name: "mac", tier: "kitty", rung: "extended", tmux: true },
            ["ctrl+s", "ctrl+k s"],
        ],
    ])("%s: save на %j", (_name, env, expected) => {
        expect(saveChords(env)).toEqual(expected);
    });
});

describe("mac-legacy: каждая топ-команда достижима доставляемой комбинацией", () => {
    // Топ первой итерации (docs/TODO/MacKeybindings.md). Save All и Replace в
    // diode пока нет — они в трекере, а не здесь.
    const TOP_COMMANDS = [
        "workbench.action.files.save",
        "workbench.action.showCommands",
        "workbench.action.quickOpen",
        "actions.find",
        "workbench.action.closeActiveEditor",
        "workbench.action.splitEditor",
        "workbench.action.nextEditor",
        "workbench.action.previousEditor",
        "editor.action.clipboardCopyAction",
        "editor.action.clipboardCutAction",
        "editor.action.clipboardPasteAction",
        "undo",
        "redo",
        "cursorWordLeft",
        "cursorWordRight",
        "cursorLineStart",
        "cursorLineEnd",
        "deleteWordLeft",
        "deleteWordRight",
        "editor.action.deleteLines",
        "editor.action.commentLine",
        "editor.action.revealDefinition",
        "references-view.findReferences",
    ];
    const registry = registerBuiltins();
    const macLegacy: Environment = { name: "mac-legacy", tier: "legacy", rung: "legacy" };

    it.each(TOP_COMMANDS)("%s", (commandId) => {
        const reachable = FOCUS_CONTEXTS.some((focus) =>
            activeEntries(registry, contextFor(macLegacy, focus)).some(
                (entry) => entry.commandId === commandId && deliverableOnMacLegacy(entry.chord),
            ),
        );
        expect(reachable).toBe(true);
    });
});
