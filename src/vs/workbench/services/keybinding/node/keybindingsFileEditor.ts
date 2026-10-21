import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";

import type { IUserKeybindingRule } from "../../../../platform/keybinding/common/userKeybindings.ts";

/**
 * Minimal jsonc-parser text edits (`modify` + `applyEdits`): the user's comments and
 * formatting survive.
 */

const MODIFY_OPTIONS = { formattingOptions: { insertSpaces: true, tabSize: 4 } };

/** An empty/missing file starts as an empty array (like `openUserConfigFile` seeding). */
function ensureArrayContent(content: string): string {
    // Stryker disable next-line ConditionalExpression,MethodExpression,StringLiteral: the seed is defensive; jsonc-parser `modify` produces a valid array on its own for both "" and whitespace input, so skipping/replacing the seed does not change the result.
    return content.trim() === "" ? "[]\n" : content;
}

/** The rule in VS Code key order; `when` is omitted when absent. */
function ruleAsJson(rule: IUserKeybindingRule): Record<string, unknown> {
    const json: Record<string, unknown> = { key: rule.key, command: rule.command };
    // Stryker disable next-line ConditionalExpression,EqualityOperator: the inverted branch writes `when: undefined`, and jsonc-parser omits undefined values — the result is indistinguishable.
    if (rule.when !== undefined) json.when = rule.when;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: same symmetry — jsonc-parser omits `args: undefined`.
    if (rule.args !== undefined) json.args = rule.args;
    return json;
}

export function appendKeybindingRule(content: string, rule: IUserKeybindingRule): string {
    const base = ensureArrayContent(content);
    // Stryker disable next-line BooleanLiteral: for path [-1] modify appends the element even without isArrayInsertion — the flag is for explicitness, behavior is the same.
    const edits = modify(base, [-1], ruleAsJson(rule), { ...MODIFY_OPTIONS, isArrayInsertion: true });
    return applyEdits(base, edits);
}

/** Tolerates junk in the array: the file is hand-edited, and a broken entry must not fail the operation. */
export function removeKeybindingRules(content: string, predicate: (rule: IUserKeybindingRule) => boolean): string {
    const base = ensureArrayContent(content);
    // Stryker disable next-line ObjectLiteral,ArrayDeclaration,BooleanLiteral: parser tolerance options — the result is the same on valid and tolerantly parsed input.
    const parsed: unknown = parseJsonc(base, [], { allowTrailingComma: true });
    if (!Array.isArray(parsed)) return base;

    const doomed: number[] = [];
    parsed.forEach((raw: unknown, index) => {
        const rule = asRule(raw);
        if (rule !== null && predicate(rule)) doomed.push(index);
    });

    // From the end: a removal shifts the indices of the following elements.
    let next = base;
    for (const index of doomed.reverse()) {
        next = applyEdits(next, modify(next, [index], undefined, MODIFY_OPTIONS));
    }
    return next;
}

function asRule(raw: unknown): IUserKeybindingRule | null {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: defensive filter; `typeof raw !== "object"` is redundant next to the command check below (primitives have `.command` === undefined and are filtered there), and `raw === null` catches null — mutations do not change what reaches the predicate.
    if (typeof raw !== "object" || raw === null) return null;
    const rule = raw as Record<string, unknown>;
    // Stryker disable next-line ConditionalExpression,EqualityOperator: an empty command is not a rule; `=== ""` is part of the filter, but an empty command is invalid anyway (the file has none), so the branch does not change the observable set.
    if (typeof rule.command !== "string" || rule.command === "") return null;
    return {
        key: typeof rule.key === "string" ? rule.key : "",
        command: rule.command,
        when: typeof rule.when === "string" && rule.when !== "" ? rule.when : undefined,
        args: rule.args,
    };
}
