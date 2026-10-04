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
 * Гейт достижимости дефолтных биндов.
 *
 * Инвариант: у КАЖДОЙ встроенной команды, у которой в данном окружении есть
 * хоть один дефолтный бинд, есть бинд, который терминал этого окружения
 * способен доставить. Иначе команда остаётся без клавиатурного пути, а её
 * подсказка в палитре и меню обещает нерабочее — именно так редактор под
 * ssh + tmux оказывался и без Ctrl+Shift+E, и без палитры (M5 в
 * docs/TODO/ParityBacklog.md).
 *
 * Гейт нужен не для разового разбора, а чтобы дыра не приехала снова со
 * следующей командой: новый бинд из «неделимого» набора (Ctrl+Shift+буква,
 * Shift+Alt+буква, Ctrl+Enter, Ctrl+Backspace, meta) краснит сборку, пока
 * рядом нет досягаемого пути.
 *
 * Критерий доставки — {@link requiresExtendedKeys}, калиброванный по разбору
 * ввода движка. Мак-специфика (Option+буква на интернациональной раскладке,
 * Ctrl+←/→ у Mission Control) живёт в `macKeybindings.test.ts`; здесь — только
 * то, что общее для всех платформ.
 */

const noopRun = (): void => undefined;

interface Environment {
    readonly name: string;
    readonly tier: "legacy" | "csi-u" | "kitty";
    readonly rung?: MacKeysRung;
}

// Враждебные окружения: ровно те, где tier не даёт расширенных клавиш. На
// csi-u/kitty недостижимых комбинаций нет по определению.
const ENVIRONMENTS: readonly Environment[] = [
    { name: "pc legacy (ssh + tmux)", tier: "legacy" },
    { name: "mac-legacy (Terminal.app)", tier: "legacy", rung: "legacy" },
];

/** Значения ключей окружения: их гейт фиксирует, остальные — свободны. */
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
 * Самый разрешительный фокус при фиксированном окружении: все не-средовые ключи
 * истинны, кроме тех, которые это же выражение отрицает (`!editorReadonly`).
 *
 * Перечислять фокус-контексты здесь незачем и вредно: вопрос гейта — «объявлен
 * ли вообще досягаемый бинд», а он от фокуса не зависит; забытый контекст дал бы
 * ложную красноту. Отрицания разбираются по тексту выражения, потому что ключ,
 * который нужен истинным одной команде и ложным другой, иначе пришлось бы
 * фиксировать глобально.
 */
function overlayFor(env: Environment, when: string | undefined): Readonly<Record<string, boolean | string | number>> {
    const negated = new Set<string>();
    for (const match of (when ?? "").matchAll(/!\s*([A-Za-z_][\w.]*)/g)) negated.add(match[1]);
    const overlay: Record<string, boolean | string | number> = {};
    const expr = when === undefined ? undefined : parseWhen(when);
    for (const name of expr === undefined ? [] : whenKeys(expr)) overlay[name] = !negated.has(name);
    return { ...overlay, ...environmentValues(env) };
}

/** Бинды, чей `when` в этом окружении может пройти (фокус — любой). */
function activeBindings(
    registry: KeybindingRegistry,
    env: Environment,
    contextKeys: ContextKeyService,
): readonly IKeybindingEntrySnapshot[] {
    return registry
        .listBindings()
        .filter((entry) => entry.when === undefined || contextKeys.evaluate(entry.when, overlayFor(env, entry.when)));
}

describe("достижимость дефолтных биндов", () => {
    const registry = registerBuiltins();

    it.each(ENVIRONMENTS.map((env) => [env.name, env] as const))(
        "%s: у каждой команды с биндом есть доставляемая комбинация",
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
        "%s: подпись бинда в палитре и меню — доставляемая",
        (_name, env) => {
            const contextKeys = new ContextKeyService();
            for (const [key, value] of Object.entries(environmentValues(env))) contextKeys.setRaw(key, value);
            const active = activeBindings(registry, env, contextKeys);
            const commandIds = [...new Set(active.map((entry) => entry.commandId))];
            const lying = commandIds
                .map((id) => {
                    // Overlay — объединение разрешительных фокусов всех биндов команды:
                    // подпись считается в том же «фокус свободен» режиме, что и гейт выше.
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

describe("асимметрия tier-гейта — пользовательский контракт", () => {
    // Команды, у которых канонический бинд VS Code объявлен под tier-гейтом
    // (терминал без extended keys его не передаёт), с подписью, которую видит
    // пользователь по обе стороны гейта: `команда | на legacy | на kitty`.
    //
    // Таблица собирается из самих биндов, а не задана руками, поэтому новый гейт
    // обязан попасть сюда осознанно — как в таблице мак-дельт. Левая колонка
    // отвечает за «есть рабочий путь», правая — за «на хорошем терминале
    // подсказка остаётся эталонной».
    const CONTRACT = [
        "deleteWordLeft | Alt+Backspace | Ctrl+Backspace",
        "editor.action.blockComment | Ctrl+K Alt+A | Shift+Alt+A",
        "editor.action.formatDocument | Ctrl+K Ctrl+E | Shift+Alt+F",
        "editor.action.organizeImports | Ctrl+K Alt+O | Shift+Alt+O",
        "editor.fold | Ctrl+K Alt+F | Ctrl+Shift+[",
        "editor.unfold | Ctrl+K Alt+U | Ctrl+Shift+]",
        "explorer.openToSide | Alt+Enter | Ctrl+Enter",
        "fileOperations.copyPath | Ctrl+K Alt+C | Shift+Alt+C",
        "git.commit | Alt+Enter | Ctrl+Enter",
        "input.deleteWordLeft | Alt+Backspace | Ctrl+Backspace",
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
        "workbench.action.search.toggleQueryDetails | Ctrl+K Alt+J | Ctrl+Shift+J",
        "workbench.action.terminal.new | Ctrl+K Alt+T | Ctrl+Shift+`",
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

    it("содержимое таблицы", () => {
        const registry = registerBuiltins();
        const contextKeys = new ContextKeyService();
        const bindings = registry.listBindings();

        /** Бинд объявлен ПОД tier-гейтом: на legacy не действует, на kitty действует. */
        const gated = (entry: IKeybindingEntrySnapshot): boolean =>
            entry.when !== undefined &&
            !contextKeys.evaluate(entry.when, overlayFor(PC_LEGACY, entry.when)) &&
            contextKeys.evaluate(entry.when, overlayFor(PC_KITTY, entry.when));

        const commandIds = [...new Set(bindings.filter(gated).map((entry) => entry.commandId))].sort();
        const rows = commandIds.map((id) => {
            // Разрешительный фокус считаем по всем when команды сразу — так же,
            // как в гейте выше: вопрос про окружение, а не про фокус.
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

describe("коллизии дефолтных биндов", () => {
    // Представительные фокус-контексты: взаимоисключающие сами по себе, поэтому
    // одна комбинация в двух из них — не коллизия. Нужны ИМЕННО здесь (в отличие
    // от гейта достижимости выше), потому что вопрос — «сработают ли два бинда
    // на одно нажатие», а он от фокуса зависит напрямую.
    const FOCUS_CONTEXTS: readonly Readonly<Record<string, boolean>>[] = [
        {},
        {
            textViewFocus: true,
            textInputFocus: true,
            editorGroupHasEditors: true,
            editorTabsMultiple: true,
            editorHasMultipleSelections: true,
        },
        { textViewFocus: true, textInputFocus: true, suggestWidgetVisible: true },
        { textViewFocus: true, textInputFocus: true, findWidgetVisible: true },
        { inputWidgetFocus: true },
        { listFocus: true, filesExplorerFocus: true },
        { searchViewletFocus: true, searchViewletVisible: true, inputWidgetFocus: true },
        { scmInputFocus: true, inputWidgetFocus: true },
    ];

    /**
     * Пары «одна комбинация — две команды», разрешаемые порядком регистрации
     * (`KeybindingRegistry.resolveKey` берёт последний подходящий бинд). Список —
     * контракт: лидер-аккорд `Ctrl+K <клавиша>` разбирает общий префикс, и занятую
     * букву легко не заметить, поэтому новая пара обязана попасть в этот список
     * осознанно, а не появиться молча.
     */
    const KNOWN_COLLISIONS = [
        // При открытом попапе автодополнения навигация достаётся ему, а не
        // редактору: у suggest-экшенов вес выше.
        "ctrl+space: editor.action.triggerSuggest / toggleSuggestionDetails",
        "down: cursorDown / selectNextSuggestion",
        "pagedown: cursorPageDown / selectNextPageSuggestion",
        "pageup: cursorPageUp / selectPrevPageSuggestion",
        "tab: acceptSelectedSuggestion / editor.action.indentLines",
        "up: cursorUp / selectPrevSuggestion",
        // Давний долг pc-раскладки, трекер — docs/TODO/MacKeybindings.md.
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

    it("подсветка конфликтов в редакторе шорткатов не ловит дубль одной команды", () => {
        // `findConflictingBindings` сравнивает when строками, поэтому безусловный
        // фолбэк рядом с условным биндом ТОЙ ЖЕ команды подсветился бы как
        // конфликт. Такого быть не должно: это не конфликт, а два пути к одному.
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
