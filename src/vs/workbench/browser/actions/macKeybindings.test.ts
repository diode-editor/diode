import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
    contextFor,
    type Environment,
    ENVIRONMENTS,
    FOCUS_CONTEXTS,
    registerBuiltins,
} from "../../../../TestUtils/builtinKeybindings.ts";
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

interface IVscodeReference {
    readonly commands: Readonly<Record<string, { readonly linux: readonly string[]; readonly mac: readonly string[] }>>;
}

/** Срез дефолтных биндов VS Code 1.138 для команд diode (см. поле source в файле). */
const VSCODE_REFERENCE = JSON.parse(
    readFileSync(new URL("./macKeybindings.vscodeReference.json", import.meta.url), "utf8"),
) as IVscodeReference;

const noopRun = (): void => undefined;

function action(partial: Partial<CommandAction> & { id: string }): CommandAction {
    return { title: partial.id, run: noopRun, ...partial };
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
    // Ctrl+←/→ (именно без других модификаторов) забирает Mission Control.
    const onlyCtrl = part.ctrlKey && !part.shiftKey && !part.altKey && !part.metaKey;
    if (onlyCtrl && (part.key === "ArrowLeft" || part.key === "ArrowRight")) return true;
    // Home/End в мак-терминалах скроллят буфер.
    return part.key === "Home" || part.key === "End";
}

function deliverableOnMacLegacy(chord: readonly Keybinding[]): boolean {
    // Option+Escape в legacy — это ESC ESC: неотличим от двух Escape подряд.
    const altEscape = chord.some((part) => part.altKey && part.key === "Escape");
    return !requiresExtendedKeys([...chord]) && !chord.some(isMacTrap) && !altEscape;
}

/** Ctrl-формы `mod`-биндов: на рунгах ниже cmd эти аккорды заняты фоллбэком. */
function modFallbackChords(): ReadonlySet<string> {
    const chords = new Set<string>();
    for (const entry of registerBuiltins().listBindings()) {
        if (entry.when?.includes("!(macKeys >= 3)") === true) chords.add(serializeChord(entry.chord));
    }
    return chords;
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
            ["ctrl+left", "!(macKeys >= 1)"],
            ["ctrl+k left", undefined],
            ["alt+left", "tier == 'legacy'"],
            ["alt+left", "macKeys >= 1"],
        ]);
    });

    it("условный бинд-АККОРД переносится целиком: чорд не разворачивается в одну часть", () => {
        // Среди дефолтов такой формы сейчас нет (условные бинды — одиночные
        // комбинации), но форма разрешена `ConditionalKeybinding`, и ошибка здесь
        // молча превратила бы Ctrl+K Ctrl+E в Ctrl+K.
        const result = withMacKeybindings(
            action({
                id: "a",
                keybinding: { keys: parseChord("ctrl+k ctrl+e"), when: "tier != 'legacy'" },
                keybindings: [parseKeybinding("ctrl+e")],
            }),
            deltas({ command: "a", pcOnly: ["ctrl+e"] }),
        );
        expect(
            result.keybindings?.map((entry) => {
                const conditional = entry as { keys: Keybinding[]; when?: string };
                return [serializeChord(conditional.keys), conditional.when];
            }),
        ).toEqual([
            ["ctrl+k ctrl+e", "tier != 'legacy'"],
            ["ctrl+e", "!(macKeys >= 1)"],
        ]);
    });

    it("pcOnly сверяется с объявлением, включая mod и условие", () => {
        const result = withMacKeybindings(
            action({ id: "a", keybinding: { keys: parseKeybinding("mod+a"), when: "listFocus" } }),
            deltas({ command: "a", pcOnly: ["mod+a"] }),
        );
        expect(result.keybindings).toEqual([
            { keys: [parseKeybinding("mod+a")], when: "(listFocus) && (!(macKeys >= 1))" },
        ]);
    });

    it("pcOnly, которого нет среди биндов, — ошибка таблицы", () => {
        expect(() =>
            withMacKeybindings(action({ id: "a" }), deltas({ command: "a", pcOnly: ["ctrl+q", "ctrl+w"] })),
        ).toThrow("a: pcOnly ctrl+q, ctrl+w не найден среди биндов команды");
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
            "cursorBottom | -ctrl+end | meta+down@cmd",
            "cursorBottomSelect | -ctrl+shift+end | shift+meta+down@cmd",
            "cursorDown | ctrl+n@cmd",
            "cursorEnd | meta+right@cmd",
            "cursorEndSelect | shift+meta+right@cmd",
            "cursorHome | meta+left@cmd",
            "cursorHomeSelect | shift+meta+left@cmd",
            "cursorLeft | ctrl+b@cmd",
            "cursorLineEnd | ctrl+e@legacy",
            "cursorLineStart | ctrl+a@legacy",
            "cursorRight | ctrl+f@cmd",
            "cursorTop | -ctrl+home | meta+up@cmd",
            "cursorTopSelect | -ctrl+shift+home | shift+meta+up@cmd",
            "cursorUp | ctrl+p@cmd",
            "cursorWordLeft | -ctrl+left",
            "cursorWordLeftSelect | -ctrl+shift+left | shift+alt+left@legacy",
            "cursorWordRight | -ctrl+right",
            "cursorWordRightSelect | -ctrl+shift+right | shift+alt+right@legacy",
            "deleteAllLeft | meta+backspace@cmd",
            "deleteLeft | ctrl+backspace@extended ctrl+h@legacy",
            "deleteRight | ctrl+delete@legacy ctrl+d@cmd",
            "deleteWordLeft | -ctrl+backspace",
            "deleteWordRight | -ctrl+delete | alt+delete@legacy",
            "editor.action.copyLinesDownAction | -ctrl+shift+alt+down | shift+alt+down@legacy",
            "editor.action.copyLinesUpAction | -ctrl+shift+alt+up | shift+alt+up@legacy",
            "editor.action.insertCursorAbove | -shift+alt+up | alt+meta+up@cmd",
            "editor.action.insertCursorBelow | -shift+alt+down | alt+meta+down@cmd",
            "editor.action.nextMatchFindAction | meta+g@cmd",
            "editor.action.previousMatchFindAction | shift+meta+g@cmd",
            "editor.action.selectAll | -mod+a | meta+a@cmd",
            "editor.action.triggerSuggest | alt+escape@extended",
            "editor.fold | -ctrl+shift+[ | alt+meta+[@cmd",
            "editor.unfold | -ctrl+shift+] | alt+meta+]@cmd",
            "fileOperations.deleteFile | meta+backspace@cmd",
            "input.cursorEnd | meta+right@cmd",
            "input.cursorHome | meta+left@cmd",
            "input.cursorLeft | ctrl+b@cmd",
            "input.cursorRight | ctrl+f@cmd",
            "input.cursorWordLeft | -ctrl+left | alt+left@legacy",
            "input.cursorWordRight | -ctrl+right | alt+right@legacy",
            "input.deleteLeft | ctrl+backspace@extended ctrl+h@legacy",
            "input.deleteRight | ctrl+delete@legacy ctrl+d@cmd",
            "input.deleteWordLeft | -ctrl+backspace",
            "input.deleteWordRight | -ctrl+delete | alt+delete@legacy",
            "input.selectToEnd | shift+meta+right@cmd",
            "input.selectToHome | shift+meta+left@cmd",
            "input.selectWordLeft | -ctrl+shift+left | shift+alt+left@legacy",
            "input.selectWordRight | -ctrl+shift+right | shift+alt+right@legacy",
            "scrollLineDown | -ctrl+down | ctrl+pagedown@legacy",
            "scrollLineUp | -ctrl+up | ctrl+pageup@legacy",
            "selectNextSuggestion | ctrl+n@cmd",
            "selectPrevSuggestion | ctrl+p@cmd",
            "showNextParameterHint | ctrl+n@cmd",
            "showPrevParameterHint | ctrl+p@cmd",
            "workbench.action.closeOtherEditors | alt+meta+t@cmd",
            "workbench.action.files.openFolder | -ctrl+k ctrl+o",
            "workbench.action.moveEditorToNextGroup | -ctrl+alt+right | ctrl+meta+right@cmd",
            "workbench.action.moveEditorToPreviousGroup | -ctrl+alt+left | ctrl+meta+left@cmd",
            "workbench.action.navigateBack | -ctrl+alt+- | ctrl+-@legacy",
            "workbench.action.nextEditor | -ctrl+pagedown | shift+meta+]@cmd alt+meta+right@cmd",
            "workbench.action.nextEditorInGroup | meta+k alt+meta+right@cmd",
            "workbench.action.output.toggleOutput | -ctrl+k ctrl+h | shift+meta+u@cmd",
            "workbench.action.previousEditor | -ctrl+pageup | shift+meta+[@cmd alt+meta+left@cmd",
            "workbench.action.previousEditorInGroup | meta+k alt+meta+left@cmd",
            "workbench.action.showAllEditors | -ctrl+k ctrl+p | alt+meta+tab@cmd",
            "workbench.action.toggleEditorGroupLayout | -shift+alt+0 | alt+meta+0@cmd",
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
        // Исключение одно: Ctrl-аккорд, который ниже cmd занят фоллбэком mod другой
        // команды (⌃N — New File), живёт с cmd, где mod — уже Cmd.
        const taken = modFallbackChords();
        const tooHigh = MAC_KEYBINDING_DELTAS.flatMap((delta) =>
            (delta.mac ?? [])
                .filter(({ keys, from }) => {
                    const chord = parseChord(keys);
                    return from !== "legacy" && deliverableOnMacLegacy(chord) && !taken.has(serializeChord(chord));
                })
                .map(({ keys }) => `${delta.command}: ${keys}`),
        );
        expect(tooHigh).toEqual([]);
    });

    it("Ctrl-аккорд с рунга cmd — только если ниже он занят фоллбэком mod (не запирать зря)", () => {
        const taken = modFallbackChords();
        const lockedWithoutReason = MAC_KEYBINDING_DELTAS.flatMap((delta) =>
            (delta.mac ?? [])
                .filter(({ keys, from }) => from === "cmd" && !parseChord(keys).some((part) => part.metaKey))
                .filter(({ keys }) => !taken.has(serializeChord(parseChord(keys))))
                .map(({ keys }) => `${delta.command}: ${keys}`),
        );
        expect(lockedWithoutReason).toEqual([]);
    });
});

// Конфликты pc-раскладки, существовавшие до мак-паритета (оба бинда — pc-шные, мак
// их лишь унаследовал ниже cmd). Трекер: docs/TODO/MacKeybindings.md.
const PRE_EXISTING_PC_CONFLICTS = new Set([
    "ctrl+k ctrl+u: editor.action.removeCommentLine / editor.action.showHover",
    "ctrl+k ctrl+f: editor.action.formatSelection / workbench.action.navigateForward",
]);

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
                const conflict = `${chord}: ${[...commands].sort().join(" / ")}`;
                if (involvesMacFamily && commands.size > 1 && !PRE_EXISTING_PC_CONFLICTS.has(conflict)) {
                    conflicts.add(conflict);
                }
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

describe("паритет с мак-раскладкой VS Code (эталон 1.138)", () => {
    // Независимая сверка со срезом дефолтных биндов VS Code — пропуск в таблице
    // дельт или в mod-переводе ловится здесь, а не глазами. Сравнение
    // симметричное, в одном и том же фокусе: мак-бинд эталона обязан действовать
    // на mac-cmd, если его pc-пара из эталона действует в diode на pc. Чего нет и на
    // pc, — дыра pc-паритета, не мака. Мак-бинды без pc-пары (Option-слова,
    // WinCtrl-подслой, ⌘↑/↓) обязаны действовать всегда.
    const registry = registerBuiltins();
    const pc: Environment = { name: "pc", tier: "kitty" };
    const macCmd: Environment = { name: "mac-cmd", tier: "kitty", rung: "cmd" };
    const FOCUS: readonly Readonly<Record<string, boolean>>[] = [
        {},
        { textViewFocus: true, textInputFocus: true, editorGroupHasEditors: true, editorTabsMultiple: true },
        { textViewFocus: true, textInputFocus: true, suggestWidgetVisible: true },
        {
            textViewFocus: true,
            textInputFocus: true,
            parameterHintsVisible: true,
            parameterHintsMultipleSignatures: true,
        },
        { textViewFocus: true, textInputFocus: true, findWidgetVisible: true },
        { inputWidgetFocus: true },
        { listFocus: true },
    ];
    // Осознанные отклонения (docs/TODO/MacKeybindings.md) и решение про копипаст.
    const DEVIATIONS = new Set([
        "fileOperations.rename: enter", // Enter=rename требует ⌘↓=open — такой команды нет
        "editor.action.clipboardCopyAction: meta+c", // Cmd+C/V/X — эмулятору
        "editor.action.clipboardCutAction: meta+x",
        "editor.action.clipboardPasteAction: meta+v",
        "input.copy: meta+c",
        "input.cut: meta+x",
        "input.paste: meta+v",
        "fileOperations.copy: meta+c",
        "fileOperations.cut: meta+x",
        "fileOperations.paste: meta+v",
    ]);

    const activeIn = (env: Environment, focus: Readonly<Record<string, boolean>>, commandId: string, keys: string) => {
        const spec = serializeChord(parseChord(keys));
        return activeEntries(registry, contextFor(env, focus)).some(
            (entry) => entry.commandId === commandId && serializeChord(entry.chord) === spec,
        );
    };
    /** pc-пара мак-бинда в эталоне: Cmd → Ctrl (механика) либо тот же аккорд. */
    const pcCounterpart = (mac: string, linux: readonly string[]): string | undefined => {
        const chord = parseChord(mac);
        const mechanical = serializeChord(
            chord.map((part) => (part.metaKey ? { ...part, metaKey: false, ctrlKey: true } : part)),
        );
        if (chord.some((part) => part.metaKey) && linux.includes(mechanical)) return mechanical;
        return linux.includes(mac) ? mac : undefined;
    };

    const cases = Object.entries(VSCODE_REFERENCE.commands).flatMap(([commandId, ref]) =>
        ref.mac
            .filter((keys) => !DEVIATIONS.has(`${commandId}: ${keys}`))
            .map((keys) => [`${commandId}: ${keys}`, commandId, keys, pcCounterpart(keys, ref.linux)] as const),
    );

    it.each(cases)("%s", (_name, commandId, keys, counterpart) => {
        const missing = FOCUS.filter((focus) =>
            counterpart === undefined
                ? false
                : activeIn(pc, focus, commandId, counterpart) && !activeIn(macCmd, focus, commandId, keys),
        );
        expect(missing).toEqual([]);
        if (counterpart === undefined) {
            expect(FOCUS.some((focus) => activeIn(macCmd, focus, commandId, keys))).toBe(true);
        }
    });
});

describe("каждый мак-бинд таблицы действует на своём рунге и выше", () => {
    // Условие мак-бинда — только рунг, а фокус задаёт when самой команды. Ищем
    // фокус-контекст, где бинд действует; на всех рунгах от from до cmd он обязан
    // найтись — иначе бинд потерян (как Option+← на mac-cmd, если его перекрыть
    // tier-условием legacy-фоллбэка).
    const registry = registerBuiltins();
    const RUNG_ENV: Record<MacKeysRung, Environment> = {
        legacy: { name: "mac-legacy", tier: "legacy", rung: "legacy" },
        extended: { name: "mac-extended", tier: "csi-u", rung: "extended" },
        cmd: { name: "mac-cmd", tier: "kitty", rung: "cmd" },
    };
    const RUNGS: readonly MacKeysRung[] = ["legacy", "extended", "cmd"];
    const EXTRA_FOCUS: readonly Readonly<Record<string, boolean>>[] = [
        ...FOCUS_CONTEXTS,
        { textViewFocus: true, textInputFocus: true, suggestWidgetVisible: true },
        {
            textViewFocus: true,
            textInputFocus: true,
            parameterHintsVisible: true,
            parameterHintsMultipleSignatures: true,
        },
        { textViewFocus: true, textInputFocus: true, findWidgetVisible: true },
        { listFocus: true, filesExplorerFocus: true },
    ];
    const cases = MAC_KEYBINDING_DELTAS.flatMap((delta) =>
        (delta.mac ?? []).flatMap(({ keys, from }) =>
            RUNGS.slice(RUNGS.indexOf(from)).map(
                (rung) => [`${delta.command}: ${keys} @ ${rung}`, delta.command, keys, rung] as const,
            ),
        ),
    );

    it.each(cases)("%s", (_name, commandId, keys, rung) => {
        const spec = serializeChord(parseChord(keys));
        const active = EXTRA_FOCUS.some((focus) =>
            activeEntries(registry, contextFor(RUNG_ENV[rung], focus)).some(
                (entry) => entry.commandId === commandId && serializeChord(entry.chord) === spec,
            ),
        );
        expect(active).toBe(true);
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
