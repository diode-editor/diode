import { scanWhen, type WhenToken } from "./scanner.ts";

/** Arrays and objects are for the `in` operator. */
export type ContextKeyValue =
    | boolean
    | string
    | number
    | readonly (boolean | string | number)[]
    | Readonly<Record<string, unknown>>
    | undefined;

/** There is no name registry: an unknown key is just `undefined`. */
export interface IContext {
    getValue(key: string): ContextKeyValue;
}

/** Nodes as in upstream `contextkey.ts`, but without normalization: the tree mirrors the string. */
export type ContextKeyExpression =
    | { readonly type: "true" }
    | { readonly type: "false" }
    | { readonly type: "defined"; readonly key: string }
    | { readonly type: "not"; readonly expr: ContextKeyExpression }
    | { readonly type: "equals" | "notEquals"; readonly key: string; readonly value: string }
    | {
          readonly type: "greater" | "greaterEquals" | "smaller" | "smallerEquals";
          readonly key: string;
          /** A number if `parseFloat` parses the right-hand side; otherwise a string, and the comparison is false. */
          readonly value: number | string;
      }
    | { readonly type: "regex"; readonly key: string; readonly regexp: RegExp }
    | { readonly type: "in" | "notIn"; readonly key: string; readonly valueKey: string }
    | { readonly type: "and" | "or"; readonly exprs: readonly ContextKeyExpression[] };

type ComparisonType = "greater" | "greaterEquals" | "smaller" | "smallerEquals";

const COMPARISONS: Partial<Record<WhenToken["type"], ComparisonType>> = {
    "<": "smaller",
    "<=": "smallerEquals",
    ">": "greater",
    ">=": "greaterEquals",
};

const PARSE_ERROR = new Error("when: parse error");

/**
 * Grammar of upstream `Parser`:
 * `or := and ('||' and)*`, `and := term ('&&' term)*`,
 * `term := '!' (KEY | true | false | '(' or ')') | primary`,
 * `primary := true | false | '(' or ')' | KEY [op value | '=~' REGEX | 'not' 'in' value]`.
 * The parser never consumes the `eof` token, so the position never runs past the array.
 */
class Parser {
    private current = 0;

    public constructor(private readonly tokens: readonly WhenToken[]) {}

    public parse(): ContextKeyExpression {
        const expr = this.or();
        if (this.peek().type !== "eof") throw PARSE_ERROR;
        return expr;
    }

    private or(): ContextKeyExpression {
        const exprs = [this.and()];
        while (this.matchOne("||")) exprs.push(this.and());
        return exprs.length === 1 ? exprs[0] : { type: "or", exprs };
    }

    private and(): ContextKeyExpression {
        const exprs = [this.term()];
        while (this.matchOne("&&")) exprs.push(this.term());
        return exprs.length === 1 ? exprs[0] : { type: "and", exprs };
    }

    private term(): ContextKeyExpression {
        if (!this.matchOne("!")) return this.primary();
        const token = this.peek();
        switch (token.type) {
            case "true":
                this.advance();
                return { type: "false" };
            case "false":
                this.advance();
                return { type: "true" };
            case "(":
                this.advance();
                return { type: "not", expr: this.parenthesized() };
            case "str":
                this.advance();
                return { type: "not", expr: { type: "defined", key: token.lexeme } };
            default:
                throw PARSE_ERROR;
        }
    }

    private primary(): ContextKeyExpression {
        const token = this.peek();
        switch (token.type) {
            case "true":
                this.advance();
                return { type: "true" };
            case "false":
                this.advance();
                return { type: "false" };
            case "(":
                this.advance();
                return this.parenthesized();
            case "str":
                this.advance();
                return this.keyExpression(token.lexeme);
            default:
                throw PARSE_ERROR;
        }
    }

    private parenthesized(): ContextKeyExpression {
        const expr = this.or();
        if (!this.matchOne(")")) throw PARSE_ERROR;
        return expr;
    }

    private keyExpression(key: string): ContextKeyExpression {
        if (this.matchOne("=~")) return { type: "regex", key, regexp: this.regex() };
        if (this.matchOne("not")) {
            if (!this.matchOne("in")) throw PARSE_ERROR;
            return { type: "notIn", key, valueKey: this.value() };
        }
        const op = this.peek().type;
        const comparison = COMPARISONS[op];
        if (comparison !== undefined) {
            this.advance();
            return comparisonExpression(comparison, key, this.value());
        }
        switch (op) {
            case "==":
            case "!=": {
                this.advance();
                // Like upstream: `a == true` is `a`, while `a == 'true'` compares with a string.
                const literal = this.peek().type;
                if (literal === "true" || literal === "false") {
                    this.advance();
                    const defined: ContextKeyExpression = { type: "defined", key };
                    return (literal === "true") === (op === "==") ? defined : { type: "not", expr: defined };
                }
                return { type: op === "==" ? "equals" : "notEquals", key, value: this.value() };
            }
            case "in":
                this.advance();
                return { type: "in", key, valueKey: this.value() };
            default:
                return { type: "defined", key };
        }
    }

    /** Right-hand side of an operator. Empty (`foo == `) is allowed: existing extensions write it this way. */
    private value(): string {
        const token = this.peek();
        switch (token.type) {
            case "str":
            case "quotedStr":
                this.advance();
                return token.lexeme;
            case "true":
            case "false":
            case "in":
                this.advance();
                return token.type;
            default:
                return "";
        }
    }

    private regex(): RegExp {
        const token = this.peek();
        if (token.type !== "regexStr") throw PARSE_ERROR;
        this.advance();
        const closing = token.lexeme.lastIndexOf("/");
        // The g and y flags make `test` stateful; upstream strips them.
        const flags = token.lexeme.substring(closing + 1).replace(/[gy]/g, "");
        try {
            return new RegExp(token.lexeme.substring(1, closing), flags);
        } catch {
            throw PARSE_ERROR;
        }
    }

    private matchOne(type: WhenToken["type"]): boolean {
        if (this.peek().type !== type) return false;
        this.advance();
        return true;
    }

    private advance(): void {
        this.current++;
    }

    private peek(): WhenToken {
        return this.tokens[this.current];
    }
}

function comparisonExpression(type: ComparisonType, key: string, text: string): ContextKeyExpression {
    const number = parseFloat(text);
    return { type, key, value: Number.isNaN(number) ? text : number };
}

/** No separate check for `error` tokens: no grammar rule accepts them. */
// Stryker disable BlockStatement: equivalent, an empty catch also yields undefined
export function parseWhen(input: string): ContextKeyExpression | undefined {
    try {
        return new Parser(scanWhen(input)).parse();
    } catch {
        return undefined;
    }
}
// Stryker restore BlockStatement

/** No eviction: trees are immutable and the set of strings is bounded by registrations. */
const parseCache = new Map<string, ContextKeyExpression | undefined>();

export function deserializeWhen(input: string): ContextKeyExpression | undefined {
    if (parseCache.has(input)) return parseCache.get(input);
    const expr = parseWhen(input);
    parseCache.set(input, expr);
    return expr;
}

/** Upstream semantics: loose `==`, `parseFloat` in comparisons. */
export function evaluateWhen(expr: ContextKeyExpression, context: IContext): boolean {
    switch (expr.type) {
        case "true":
            return true;
        case "false":
            return false;
        case "defined":
            return !!context.getValue(expr.key);
        case "not":
            return !evaluateWhen(expr.expr, context);
        case "equals":
            return context.getValue(expr.key) == expr.value;
        case "notEquals":
            return context.getValue(expr.key) != expr.value;
        case "greater":
        case "greaterEquals":
        case "smaller":
        case "smallerEquals":
            return compare(expr.type, context.getValue(expr.key), expr.value);
        case "regex":
            return expr.regexp.test(scalarText(context.getValue(expr.key)));
        case "in":
            return isIn(context.getValue(expr.key), context.getValue(expr.valueKey));
        case "notIn":
            return !isIn(context.getValue(expr.key), context.getValue(expr.valueKey));
        case "and":
            return expr.exprs.every((child) => evaluateWhen(child, context));
        case "or":
            return expr.exprs.some((child) => evaluateWhen(child, context));
    }
}

function compare(type: ComparisonType, actual: ContextKeyValue, expected: number | string): boolean {
    // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent, a non-numeric right-hand side already makes the NaN comparison false; the branch is for the types and the reader
    if (typeof expected === "string") return false;
    const left = parseFloat(scalarText(actual));
    switch (type) {
        case "greater":
            return left > expected;
        case "greaterEquals":
            return left >= expected;
        case "smaller":
            return left < expected;
        case "smallerEquals":
            return left <= expected;
    }
}

/** Arrays and objects (values for `in`) have no text. */
function scalarText(value: ContextKeyValue): string {
    return typeof value === "object" ? "" : String(value);
}

function isIn(item: ContextKeyValue, source: ContextKeyValue): boolean {
    if (Array.isArray(source)) return (source as readonly unknown[]).includes(item);
    if (typeof item === "string" && typeof source === "object") return Object.hasOwn(source, item);
    return false;
}

export function whenKeys(expr: ContextKeyExpression): string[] {
    const keys = new Set<string>();
    const visit = (node: ContextKeyExpression): void => {
        switch (node.type) {
            case "true":
            case "false":
                return;
            case "not":
                visit(node.expr);
                return;
            case "and":
            case "or":
                node.exprs.forEach(visit);
                return;
            case "in":
            case "notIn":
                keys.add(node.key);
                keys.add(node.valueKey);
                return;
            default:
                keys.add(node.key);
        }
    };
    visit(expr);
    return [...keys];
}

/** Keys not under negation (`!a`, `!(a && b)`, `a not in b`): "the binding is live when X", not "mentions X". */
export function whenPositiveKeys(expr: ContextKeyExpression): string[] {
    const keys = new Set<string>();
    const visit = (node: ContextKeyExpression, negated: boolean): void => {
        switch (node.type) {
            case "true":
            case "false":
            case "notIn":
                return;
            case "not":
                visit(node.expr, !negated);
                return;
            case "and":
            case "or":
                for (const child of node.exprs) visit(child, negated);
                return;
            default:
                if (!negated) keys.add(node.key);
        }
    };
    visit(expr, false);
    return [...keys];
}

/** Canonical: `&&`/`||` operands are ordered, so `b && a`, `(a) && b` and `a&&b` serialize the same. */
export function serializeWhen(expr: ContextKeyExpression): string {
    switch (expr.type) {
        case "true":
        case "false":
            return expr.type;
        case "defined":
            return expr.key;
        case "not":
            return expr.expr.type === "defined" ? `!${expr.expr.key}` : `!(${serializeWhen(expr.expr)})`;
        case "equals":
            return `${expr.key} == '${expr.value}'`;
        case "notEquals":
            return `${expr.key} != '${expr.value}'`;
        case "greater":
            return `${expr.key} > ${String(expr.value)}`;
        case "greaterEquals":
            return `${expr.key} >= ${String(expr.value)}`;
        case "smaller":
            return `${expr.key} < ${String(expr.value)}`;
        case "smallerEquals":
            return `${expr.key} <= ${String(expr.value)}`;
        case "regex":
            return `${expr.key} =~ /${expr.regexp.source}/${expr.regexp.flags}`;
        case "in":
            return `${expr.key} in '${expr.valueKey}'`;
        case "notIn":
            return `${expr.key} not in '${expr.valueKey}'`;
        case "and":
            return flatten(expr)
                .map((child) => (child.type === "or" ? `(${serializeWhen(child)})` : serializeWhen(child)))
                .sort()
                .join(" && ");
        case "or":
            return flatten(expr).map(serializeWhen).sort().join(" || ");
    }
}

function flatten(expr: Extract<ContextKeyExpression, { type: "and" | "or" }>): ContextKeyExpression[] {
    return expr.exprs.flatMap((child) => (child.type === expr.type ? flatten(child) : [child]));
}
