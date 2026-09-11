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
    return content.trim() === "" ? "[]\n" : content;
}

/** Правило в порядке ключей VS Code; `when` не пишется, когда его нет. */
function ruleAsJson(rule: IUserKeybindingRule): Record<string, unknown> {
    const json: Record<string, unknown> = { key: rule.key, command: rule.command };
    if (rule.when !== undefined) json.when = rule.when;
    return json;
}

/** Дописывает правило в конец массива. */
export function appendKeybindingRule(content: string, rule: IUserKeybindingRule): string {
    const base = ensureArrayContent(content);
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
    if (typeof raw !== "object" || raw === null) return null;
    const rule = raw as Record<string, unknown>;
    if (typeof rule.command !== "string" || rule.command === "") return null;
    return {
        key: typeof rule.key === "string" ? rule.key : "",
        command: rule.command,
        when: typeof rule.when === "string" && rule.when !== "" ? rule.when : undefined,
        args: rule.args,
    };
}
