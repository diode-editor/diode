import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
    contextFor,
    ENVIRONMENTS,
    FOCUS_CONTEXTS,
    registerBuiltins,
} from "../../../../TestUtils/builtinKeybindings.ts";
import {
    type ContextKeyExpression,
    type ContextKeyValue,
    evaluateWhen,
    parseWhen,
    whenKeys,
} from "../../../platform/contextkey/common/contextKeyExpr.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingRegistry,
} from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { serializeChord } from "../../../platform/keybinding/common/keybindingRegistry.ts";

import { builtinActions } from "./builtinActions.ts";

/**
 * Срез приоритета дефолтных биндов (F1, предохранитель переноса «порядок
 * регистрации → вес»). Эталон — `builtinKeybindings.slice.json` рядом;
 * пересобрать от текущего кода: `UPDATE_SLICE=1 npx vitest run <этот файл>`.
 *
 * Два среза:
 * - **попарное старшинство** — для каждой комбинации и каждой пары записей
 *   разных команд, которые могут быть активны одновременно, кто из них
 *   победит. Форма попарная, поэтому перестановка взаимоисключающих записей
 *   эталон не трогает, а в диффе видно «пара X/Y перевернулась»;
 * - **подписи** — `getKeybindingForCommand` каждой команды на сетке окружений
 *   и фокусов.
 */

const SLICE_URL = new URL("./builtinKeybindings.slice.json", import.meta.url);

/**
 * Подпись команды: одна на всю сетку — строкой; иначе `*` — самая частая, плюс
 * отличия по клеткам `<окружение> #<фокус-контекст>`.
 */
type Signature = string | Readonly<Record<string, string>>;

interface ISlice {
    readonly pairs: readonly string[];
    readonly signatures: Readonly<Record<string, Signature>>;
}

/** Значения, которые стоит перебрать для ключа: литералы из выражений плюс «прочее». */
function domainsOf(exprs: readonly ContextKeyExpression[]): Map<string, ContextKeyValue[]> {
    const domains = new Map<string, Set<ContextKeyValue>>();
    const add = (key: string, ...values: ContextKeyValue[]): void => {
        const domain = domains.get(key) ?? new Set<ContextKeyValue>([undefined, true]);
        for (const value of values) domain.add(value);
        domains.set(key, domain);
    };
    const visit = (node: ContextKeyExpression): void => {
        switch (node.type) {
            case "not":
                visit(node.expr);
                return;
            case "and":
            case "or":
                node.exprs.forEach(visit);
                return;
            case "equals":
            case "notEquals":
                add(node.key, node.value, "\u0000other");
                return;
            case "greater":
            case "greaterEquals":
            case "smaller":
            case "smallerEquals":
                if (typeof node.value === "number") add(node.key, node.value - 1, node.value, node.value + 1);
                return;
            default:
                for (const key of whenKeys(node)) add(key);
        }
    };
    exprs.forEach(visit);
    return new Map([...domains].map(([key, values]) => [key, [...values]]));
}

/**
 * Цели фокуса и ключи, которые при фокусе в цели могут быть истинны. Фокус у
 * дерева один, поэтому валиден только контекст, чьи истинные фокус-ключи
 * целиком помещаются в одну цель: `textInputFocus` и `listFocus` разом не
 * бывают, поле коммита SCM и поле поиска — разные цели. Попапы над редактором
 * (suggest, hover, подсказка параметров, призрак inline) гаснут, когда фокус
 * уходит с редактора, — их ключи живут только в цели «редактор».
 */
const FOCUS_TARGETS: readonly (readonly string[])[] = [
    [
        "textViewFocus",
        "textInputFocus",
        "editorReadonly",
        "editorHasMultipleSelections",
        "suggestWidgetVisible",
        "editorHoverVisible",
        "parameterHintsVisible",
        "parameterHintsMultipleSignatures",
        "inlineSuggestionVisible",
    ],
    ["inputWidgetFocus"],
    ["inputWidgetFocus", "scmInputFocus"],
    ["inputWidgetFocus", "searchInputBoxFocus"],
    ["listFocus"],
    ["listFocus", "filesExplorerFocus"],
    ["listFocus", "firstMatchFocus"],
    ["terminalFocus"],
];
const FOCUS_KEYS = new Set(FOCUS_TARGETS.flat());

function focusConsistent(values: ReadonlyMap<string, ContextKeyValue>): boolean {
    const focused = [...FOCUS_KEYS].filter((key) => values.get(key) === true);
    return focused.length === 0 || FOCUS_TARGETS.some((target) => focused.every((key) => target.includes(key)));
}

/** Есть ли контекст, где все выражения истинны. Перебор полный, если мал, иначе — детерминированная выборка. */
function canBeActiveTogether(whens: readonly (string | undefined)[]): boolean {
    const exprs = whens.flatMap((when) => (when === undefined ? [] : [parseWhen(when)!]));
    const domains = [...domainsOf(exprs)];
    const total = domains.reduce((product, [, values]) => product * values.length, 1);
    const LIMIT = 20_000;
    let seed = 1;
    for (let n = 0; n < Math.min(total, LIMIT); n++) {
        const values = new Map<string, ContextKeyValue>();
        let rest = total <= LIMIT ? n : (seed = (seed * 48271) % 2147483647);
        for (const [key, domain] of domains) {
            values.set(key, domain[rest % domain.length]);
            rest = Math.floor(rest / domain.length);
        }
        if (!focusConsistent(values)) continue;
        const context = { getValue: (key: string) => values.get(key) };
        if (exprs.every((expr) => evaluateWhen(expr, context))) return true;
    }
    return false;
}

function describeEntry(entry: IKeybindingEntrySnapshot): string {
    return entry.when === undefined ? entry.commandId : `${entry.commandId} [${entry.when}]`;
}

/**
 * Попарное старшинство: «chord: сильнее > слабее». Сильнее — запись, стоящая
 * позже в `listBindings()`: резолвер отдаёт комбинацию последней записи с
 * проходящим when (что это верно, проверяет отдельный тест ниже).
 */
function pairwiseSlice(registry: KeybindingRegistry): string[] {
    const groups = new Map<string, IKeybindingEntrySnapshot[]>();
    for (const entry of registry.listBindings()) {
        const chord = serializeChord(entry.chord);
        groups.set(chord, [...(groups.get(chord) ?? []), entry]);
    }
    const pairs = new Set<string>();
    for (const [chord, entries] of groups) {
        for (let weaker = 0; weaker < entries.length; weaker++) {
            for (let stronger = weaker + 1; stronger < entries.length; stronger++) {
                const [a, b] = [entries[weaker], entries[stronger]];
                if (a.commandId === b.commandId) continue;
                if (!canBeActiveTogether([a.when, b.when])) continue;
                pairs.add(`${chord}: ${describeEntry(b)} > ${describeEntry(a)}`);
            }
        }
    }
    return [...pairs].sort();
}

function signatureSlice(registry: KeybindingRegistry): ISlice["signatures"] {
    const commands = [...new Set(registry.listBindings().map((entry) => entry.commandId))].sort();
    const signatures: Record<string, Signature> = {};
    for (const commandId of commands) {
        const cells = new Map<string, string>();
        for (const env of ENVIRONMENTS) {
            FOCUS_CONTEXTS.forEach((focus, index) => {
                const chord = registry.getKeybindingForCommand(commandId, contextFor(env, focus));
                cells.set(`${env.name} #${String(index)}`, chord === undefined ? "" : serializeChord(chord));
            });
        }
        const counts = new Map<string, number>();
        for (const chord of cells.values()) counts.set(chord, (counts.get(chord) ?? 0) + 1);
        const common = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        const overrides = [...cells].filter(([, chord]) => chord !== common);
        signatures[commandId] = overrides.length === 0 ? common : Object.fromEntries([["*", common], ...overrides]);
    }
    return signatures;
}

function currentSlice(registry: KeybindingRegistry): ISlice {
    return { pairs: pairwiseSlice(registry), signatures: signatureSlice(registry) };
}

describe("срез приоритета дефолтных биндов", () => {
    const registry = registerBuiltins();
    const current = currentSlice(registry);
    if (process.env.UPDATE_SLICE === "1") writeFileSync(SLICE_URL, `${JSON.stringify(current, null, 4)}\n`);
    const reference = JSON.parse(readFileSync(SLICE_URL, "utf8")) as ISlice;

    it("попарное старшинство совпадает с эталоном", () => {
        // Срез обязан быть содержательным: конфликтующих пар — десятки.
        expect(current.pairs.length).toBeGreaterThan(20);
        expect(current.pairs).toEqual(reference.pairs);
    });

    it("подписи команд совпадают с эталоном", () => {
        expect(current.signatures).toEqual(reference.signatures);
    });

    it("старшинство в срезе — то, что реально выбирает резолвер", () => {
        // Для каждой пары находим контекст сетки, где активны ровно обе и никого
        // сильнее, и сверяем с resolveKey. Пары, которые сетка не накрывает,
        // пропускаются — их проверяет попарная форма выше.
        let checked = 0;
        const entries = registry.listBindings();
        for (const env of ENVIRONMENTS) {
            for (const focus of FOCUS_CONTEXTS) {
                const context = contextFor(env, focus);
                const active = entries.filter((entry) => entry.when === undefined || context.evaluate(entry.when));
                const strongest = new Map<string, IKeybindingEntrySnapshot>();
                for (const entry of active) {
                    if (entry.chord.length === 1) strongest.set(serializeChord(entry.chord), entry);
                }
                for (const entry of strongest.values()) {
                    const resolution = registry.resolveKey(entry.chord[0], context);
                    registry.resetPending();
                    expect(resolution).toMatchObject({ kind: "command", commandId: entry.commandId });
                    checked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(100);
    });

    // Замер для F1: сколько пар держится только на порядке регистрации. После
    // весов у семейств (F1, PR3) тест включается и обязан совпасть с эталоном.
    it.skip("порядок регистрации не влияет на старшинство", () => {
        const reversed = registerBuiltins([...builtinActions].reverse());
        expect(pairwiseSlice(reversed)).toEqual(reference.pairs);
    });
});
