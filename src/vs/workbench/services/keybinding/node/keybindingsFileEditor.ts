import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";

import type { IUserKeybindingRule } from "../../../../platform/keybinding/node/keybindingsService.ts";

/**
 * Правки текста `keybindings.json` (массив правил, JSONC): чистые функции над
 * содержимым файла. Правки — минимальные text edits jsonc-parser (`modify` +
 * `applyEdits`), поэтому комментарии и форматирование пользователя выживают.
 * Чтение/запись на диск и семантика операций (unbind-пары, reset) — в
 * `KeybindingsEditorService`.
 */

const MODIFY_OPTIONS = { formattingOptions: { insertSpaces: true, tabSize: 4 } };

/** Пустой/отсутствующий файл стартует с пустого массива (как сидирование `openUserConfigFile`). */
function ensureArrayContent(content: string): string {
    // Stryker disable next-line ConditionalExpression,MethodExpression,StringLiteral: сид — защитный; jsonc-parser `modify` и на «» и на пробельном входе даёт валидный массив сам, так что пропуск/подмена сида результат не меняет.
    return content.trim() === "" ? "[]\n" : content;
}

/** Правило в порядке ключей VS Code; `when` не пишется, когда его нет. */
function ruleAsJson(rule: IUserKeybindingRule): Record<string, unknown> {
    const json: Record<string, unknown> = { key: rule.key, command: rule.command };
    // Stryker disable next-line ConditionalExpression,EqualityOperator: обратная ветка пишет `when: undefined`, а jsonc-parser undefined-значение опускает — результат неотличим.
    if (rule.when !== undefined) json.when = rule.when;
    return json;
}

/** Дописывает правило в конец массива. */
export function appendKeybindingRule(content: string, rule: IUserKeybindingRule): string {
    const base = ensureArrayContent(content);
    // Stryker disable next-line BooleanLiteral: для пути [-1] modify дописывает элемент и без isArrayInsertion — флаг здесь на явность, поведение то же.
    const edits = modify(base, [-1], ruleAsJson(rule), { ...MODIFY_OPTIONS, isArrayInsertion: true });
    return applyEdits(base, edits);
}

/**
 * Удаляет все правила, для которых истинен `predicate`. Толерантна к мусору в
 * массиве (не-объекты и правила без command предикату не показываются) —
 * файл руками правит пользователь, и битая запись не должна ронять операцию.
 */
export function removeKeybindingRules(
    content: string,
    predicate: (rule: IUserKeybindingRule) => boolean,
): string {
    const base = ensureArrayContent(content);
    // Stryker disable next-line ObjectLiteral,ArrayDeclaration,BooleanLiteral: опции толерантности парсера — на корректном и на tolerant-разбираемом входе результат тот же.
    const parsed: unknown = parseJsonc(base, [], { allowTrailingComma: true });
    if (!Array.isArray(parsed)) return base;

    const doomed: number[] = [];
    parsed.forEach((raw: unknown, index) => {
        const rule = asRule(raw);
        if (rule !== null && predicate(rule)) doomed.push(index);
    });

    // С конца: удаление сдвигает индексы последующих элементов.
    let next = base;
    for (const index of doomed.reverse()) {
        next = applyEdits(next, modify(next, [index], undefined, MODIFY_OPTIONS));
    }
    return next;
}

function asRule(raw: unknown): IUserKeybindingRule | null {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: защитный отсев; `typeof raw !== "object"` избыточен рядом с проверкой command ниже (у примитивов `.command` === undefined → отсев там же), а null ловит `raw === null` — мутации не меняют, что доходит до предиката.
    if (typeof raw !== "object" || raw === null) return null;
    const rule = raw as Record<string, unknown>;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: пустой command — не правило; `=== ""` часть отсева, но пустая строка как command и так недопустима (в файле её нет), так что ветка не меняет наблюдаемого состава.
    if (typeof rule.command !== "string" || rule.command === "") return null;
    return {
        key: typeof rule.key === "string" ? rule.key : "",
        command: rule.command,
        when: typeof rule.when === "string" && rule.when !== "" ? rule.when : undefined,
        args: rule.args,
    };
}
