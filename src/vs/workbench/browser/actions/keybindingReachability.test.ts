import { describe, expect, it } from "vitest";

import { registerBuiltins } from "../../../../TestUtils/builtinKeybindings.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { parseWhen, whenKeys } from "../../../platform/contextkey/common/contextKeyExpr.ts";
import { ContextKeyService } from "../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { findConflictingBindings } from "../../../platform/keybinding/common/keybindingConflicts.ts";
import { requiresExtendedKeys } from "../../../platform/keybinding/common/keybindingPortability.ts";
import {
    formatKeybinding,
    type IKeybindingEntrySnapshot,
    KeybindingRegistry,
    serializeChord,
} from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { macKeysLevel, type MacKeysRung } from "../../../platform/keybinding/common/macKeys.ts";
import { WORKBENCH_ACTIONS } from "../../workbench.common.main.ts";

/**
 * Invariant: EVERY built-in command with a default binding in an environment has a
 * binding that the environment's terminal can actually deliver — otherwise the hint
 * promises something broken, as under ssh + tmux without Ctrl+Shift+E and the command palette (#376).
 * Deliverability is decided by {@link requiresExtendedKeys}; Mac specifics live in
 * `macKeybindings.test.ts`.
 */

const noopRun = (): void => undefined;

interface Environment {
    readonly name: string;
    readonly tier: "legacy" | "csi-u" | "kitty";
    readonly rung?: MacKeysRung;
}

// Exactly the environments whose tier provides no extended keys.
const ENVIRONMENTS: readonly Environment[] = [
    { name: "pc legacy (ssh + tmux)", tier: "legacy" },
    { name: "mac-legacy (Terminal.app)", tier: "legacy", rung: "legacy" },
];

function environmentValues(env: Environment): Readonly<Record<string, boolean | string | number>> {
    const mac = env.rung !== undefined;
    return {
        tier: env.tier,
        os: mac ? "mac" : "linux",
        isMac: mac,
        isLinux: !mac,
        cap_extendedKeys: env.tier !== "legacy",
        cap_super: env.rung === "cmd",
        macKeys: macKeysLevel(env.rung),
    };
}

/**
 * All non-environment keys are true, except those this expression negates. Focus contexts
 * are not enumerated: the gate's question does not depend on focus, and a forgotten context
 * would give a false failure.
 */
function overlayFor(env: Environment, when: string | undefined): Readonly<Record<string, boolean | string | number>> {
    const negated = new Set<string>();
    for (const match of (when ?? "").matchAll(/!\s*([A-Za-z_][\w.]*)/g)) negated.add(match[1]);
    const overlay: Record<string, boolean | string | number> = {};
    const expr = when === undefined ? undefined : parseWhen(when);
    for (const name of expr === undefined ? [] : whenKeys(expr)) overlay[name] = !negated.has(name);
    return { ...overlay, ...environmentValues(env) };
}

function activeBindings(
    registry: KeybindingRegistry,
    env: Environment,
    contextKeys: ContextKeyService,
): readonly IKeybindingEntrySnapshot[] {
    return registry
        .listBindings()
        .filter((entry) => entry.when === undefined || contextKeys.evaluate(entry.when, overlayFor(env, entry.when)));
}

describe("default keybinding reachability", () => {
    const registry = registerBuiltins();

    it.each(ENVIRONMENTS.map((env) => [env.name, env] as const))(
        "%s: every command with a keybinding has a deliverable chord",
        (_name, env) => {
            const contextKeys = new ContextKeyService();
            const active = activeBindings(registry, env, contextKeys);
            const deliverable = new Set(
                active.filter((entry) => !requiresExtendedKeys(entry.chord)).map((entry) => entry.commandId),
            );
            const unreachable = [
                ...new Set(active.map((entry) => entry.commandId).filter((id) => !deliverable.has(id))),
            ].map(
                (id) =>
                    `${id}: ${active
                        .filter((entry) => entry.commandId === id)
                        .map((entry) => serializeChord(entry.chord))
                        .join(", ")}`,
            );
            expect(unreachable).toEqual([]);
        },
    );

    it.each(ENVIRONMENTS.map((env) => [env.name, env] as const))(
        "%s: the keybinding label in the command palette and menus is deliverable",
        (_name, env) => {
            const contextKeys = new ContextKeyService();
            for (const [key, value] of Object.entries(environmentValues(env))) contextKeys.setRaw(key, value);
            const active = activeBindings(registry, env, contextKeys);
            const commandIds = [...new Set(active.map((entry) => entry.commandId))];
            const lying = commandIds
                .map((id) => {
                    // Union of the permissive focuses of all the command's bindings — the same mode as the gate above.
                    const whens = active.filter((entry) => entry.commandId === id).map((entry) => entry.when);
                    const overlay = overlayFor(env, whens.filter((when) => when !== undefined).join(" && "));
                    return { id, chord: registry.getKeybindingForCommand(id, contextKeys, overlay) };
                })
                .filter(({ chord }) => chord !== undefined && requiresExtendedKeys(chord))
                .map(({ id, chord }) => `${id}: ${formatKeybinding(chord as never)}`);
            expect(lying).toEqual([]);
        },
    );
});

describe("tier gate asymmetry — user-facing contract", () => {
    // Canonical binding under the tier gate and its label on both sides: `command | on legacy | on kitty`.
    // The table is built from the bindings themselves — a new gate must land here deliberately.
    const CONTRACT = [
        "deleteWordLeft | Alt+Backspace | Ctrl+Backspace",
        "editor.action.blockComment | Ctrl+K Alt+A | Shift+Alt+A",
        "editor.action.formatDocument | Ctrl+K Ctrl+E | Shift+Alt+F",
        "editor.action.organizeImports | Ctrl+K Alt+O | Shift+Alt+O",
        "editor.action.refactor | Ctrl+K Alt+R | Ctrl+Shift+R",
        "editor.fold | Ctrl+K Alt+F | Ctrl+Shift+[",
        "editor.unfold | Ctrl+K Alt+U | Ctrl+Shift+]",
        "explorer.openToSide | Alt+Enter | Ctrl+Enter",
        "fileOperations.copyPath | Ctrl+K Alt+C | Shift+Alt+C",
        "git.commit | Alt+Enter | Ctrl+Enter",
        "input.deleteWordLeft | Alt+Backspace | Ctrl+Backspace",
        // No legacy fallback (#949): `ctrl+k ctrl+h` is Output's; the palette and the context menu run it there.
        "references-view.showCallHierarchy | Shift+Alt+H | Shift+Alt+H",
        "workbench.action.files.saveAs | Ctrl+K Alt+S | Ctrl+Shift+S",
        "workbench.action.focusFifthEditorGroup | Ctrl+K 5 | Ctrl+5",
        "workbench.action.focusFirstEditorGroup | Ctrl+K 1 | Ctrl+1",
        "workbench.action.focusFourthEditorGroup | Ctrl+K 4 | Ctrl+4",
        "workbench.action.focusSecondEditorGroup | Ctrl+K 2 | Ctrl+2",
        "workbench.action.focusThirdEditorGroup | Ctrl+K 3 | Ctrl+3",
        "workbench.action.moveEditorToNextGroup | Ctrl+K Alt+Right | Ctrl+Alt+Right",
        "workbench.action.moveEditorToPreviousGroup | Ctrl+K Alt+Left | Ctrl+Alt+Left",
        "workbench.action.navigateBack | Ctrl+K Ctrl+B | Ctrl+Alt+-",
        "workbench.action.navigateForward | Ctrl+K Ctrl+F | Ctrl+Shift+-",
        // No legacy fallback (#901): it only steps the picker up, the Up arrow does the same everywhere.
        "workbench.action.quickOpenNavigatePreviousInFilePicker | Ctrl+Shift+P | Ctrl+Shift+P",
        "workbench.action.search.toggleQueryDetails | Ctrl+K Alt+J | Ctrl+Shift+J",
        "workbench.action.terminal.focusTabs | Ctrl+K \\ | Ctrl+Shift+\\",
        "workbench.action.terminal.new | Ctrl+K Alt+T | Ctrl+Shift+`",
        // No legacy fallback (#817): the palette runs it there; the label is the canonical binding.
        "workbench.action.terminal.openDetectedLink | Ctrl+Shift+O | Ctrl+Shift+O",
        "workbench.action.terminal.toggleTerminal | Ctrl+K T | Ctrl+`",
        "workbench.action.toggleEditorGroupLayout | Ctrl+K Alt+0 | Shift+Alt+0",
        "workbench.actions.view.problems | Ctrl+K M | Ctrl+Shift+M",
        "workbench.view.explorer | Ctrl+K E | Ctrl+Shift+E",
        "workbench.view.extensions | Ctrl+K X | Ctrl+Shift+X",
        "workbench.view.scm | Ctrl+K G | Ctrl+Shift+G",
        "workbench.view.search | Ctrl+K F | Ctrl+Shift+F",
    ];

    const PC_LEGACY: Environment = { name: "pc legacy", tier: "legacy" };
    const PC_KITTY: Environment = { name: "pc kitty", tier: "kitty" };

    it("table contents", () => {
        const registry = registerBuiltins();
        const contextKeys = new ContextKeyService();
        const bindings = registry.listBindings();

        const gated = (entry: IKeybindingEntrySnapshot): boolean =>
            entry.when !== undefined &&
            !contextKeys.evaluate(entry.when, overlayFor(PC_LEGACY, entry.when)) &&
            contextKeys.evaluate(entry.when, overlayFor(PC_KITTY, entry.when));

        const commandIds = [...new Set(bindings.filter(gated).map((entry) => entry.commandId))].sort();
        const rows = commandIds.map((id) => {
            const whens = bindings
                .filter((entry) => entry.commandId === id)
                .map((entry) => entry.when)
                .filter((when) => when !== undefined)
                .join(" && ");
            const label = (env: Environment): string => {
                const envKeys = new ContextKeyService();
                for (const [key, value] of Object.entries(environmentValues(env))) envKeys.setRaw(key, value);
                const chord = registry.getKeybindingForCommand(id, envKeys, overlayFor(env, whens));
                return chord === undefined ? "—" : formatKeybinding(chord);
            };
            return `${id} | ${label(PC_LEGACY)} | ${label(PC_KITTY)}`;
        });

        expect(rows).toEqual(CONTRACT);
    });
});

describe("default keybinding collisions", () => {
    // Needed HERE specifically, unlike the gate above: "do two bindings fire on the same
    // keystroke" depends directly on focus.
    const FOCUS_CONTEXTS: readonly Readonly<Record<string, boolean>>[] = [
        {},
        {
            textViewFocus: true,
            textInputFocus: true,
            editorAreaFocus: true,
            editorGroupHasEditors: true,
            editorTabsMultiple: true,
            editorHasMultipleSelections: true,
        },
        // A non-text tab: the Keyboard Shortcuts search box and its list.
        { inputWidgetFocus: true, editorAreaFocus: true, editorGroupHasEditors: true, editorTabsMultiple: true },
        { listFocus: true, editorAreaFocus: true, editorGroupHasEditors: true, editorTabsMultiple: true },
        { textViewFocus: true, textInputFocus: true, suggestWidgetVisible: true },
        { textViewFocus: true, textInputFocus: true, findWidgetVisible: true },
        { inputWidgetFocus: true },
        { listFocus: true, filesExplorerFocus: true },
        { searchViewletFocus: true, searchViewletVisible: true, inputWidgetFocus: true },
        { scmInputFocus: true, inputWidgetFocus: true },
    ];

    /**
     * The list is a contract: a taken leader-chord letter is easy to miss, so a new
     * pair must land here deliberately (`resolveKey` takes the last binding).
     */
    const KNOWN_COLLISIONS = [
        // While the suggest popup is open it gets navigation, not the
        // editor: suggest actions have higher weight.
        "ctrl+space: editor.action.triggerSuggest / toggleSuggestionDetails",
        "down: cursorDown / selectNextSuggestion",
        "pagedown: cursorPageDown / selectNextPageSuggestion",
        "pageup: cursorPageUp / selectPrevPageSuggestion",
        "tab: acceptSelectedSuggestion / editor.action.indentLines",
        "up: cursorUp / selectPrevSuggestion",
        // Long-standing pc layout debt, tracked in docs/TODO/MacKeybindings.md.
        "ctrl+k ctrl+f: editor.action.formatSelection / workbench.action.navigateForward",
        "ctrl+k ctrl+u: editor.action.removeCommentLine / editor.action.showHover",
    ];

    const registry = registerBuiltins();

    it.each(ENVIRONMENTS.map((env) => [env.name, env] as const))("%s", (_name, env) => {
        const collisions = new Set<string>();
        for (const focus of FOCUS_CONTEXTS) {
            const contextKeys = new ContextKeyService();
            for (const [key, value] of Object.entries(environmentValues(env))) contextKeys.setRaw(key, value);
            for (const [key, value] of Object.entries(focus)) contextKeys.setRaw(key, value);
            const byChord = new Map<string, Set<string>>();
            for (const entry of registry.listBindings()) {
                if (entry.when !== undefined && !contextKeys.evaluate(entry.when)) continue;
                const chord = serializeChord(entry.chord);
                const commands = byChord.get(chord) ?? new Set<string>();
                commands.add(entry.commandId);
                byChord.set(chord, commands);
            }
            for (const [chord, commands] of byChord) {
                if (commands.size > 1) collisions.add(`${chord}: ${[...commands].sort().join(" / ")}`);
            }
        }
        expect([...collisions].sort()).toEqual([...KNOWN_COLLISIONS].sort());
    });

    it("conflict highlighting in the keyboard shortcuts editor ignores duplicates of one command", () => {
        // `findConflictingBindings` compares `when` as strings: an unconditional fallback next to
        // a conditional binding of the SAME command is not a conflict but two paths to one command.
        const entries = registerBuiltins().listBindings();
        const sameCommand = [...findConflictingBindings(entries)]
            .map((index) => entries[index])
            .filter(
                (entry, _i, flagged) =>
                    flagged.filter(
                        (other) =>
                            serializeChord(other.chord) === serializeChord(entry.chord) &&
                            other.commandId === entry.commandId,
                    ).length > 1,
            )
            .map((entry) => `${serializeChord(entry.chord)}: ${entry.commandId}`);
        expect(sameCommand).toEqual([]);
    });
});
