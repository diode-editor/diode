import { scanWhen, type WhenToken } from "./scanner.ts";

/** Значение контекст-ключа. Массив и объект нужны оператору `in` (`resource in someList`). */
export type ContextKeyValue =
    | boolean
    | string
    | number
    | readonly (boolean | string | number)[]
    | Readonly<Record<string, unknown>>
    | undefined;

/** Источник значений для вычисления: незнакомый ключ — просто `undefined`, реестра имён нет. */
export interface IContext {
    getValue(key: string): ContextKeyValue;
}

/**
 * Разобранное when-выражение. Узлы и их семантика — как у upstream
 * `vs/platform/contextkey/common/contextkey.ts`, но без нормализации: дерево
 * повторяет строку (скобки сняты, `a == true` свёрнуто в `a`, как у upstream).
 */
export type ContextKeyExpression =
    | { readonly type: "true" }
    | { readonly type: "false" }
    | { readonly type: "defined"; readonly key: string }
    | { readonly type: "not"; readonly expr: ContextKeyExpression }
    | { readonly type: "equals" | "notEquals"; readonly key: string; readonly value: string }
    | {
          readonly type: "greater" | "greaterEquals" | "smaller" | "smallerEquals";
          readonly key: string;
          /** Число, если правая часть разбирается `parseFloat`; иначе строка — и сравнение ложно. */
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

/** Ошибка разбора — один объект-маркер: разбор без восстановления, текст ошибки никому не нужен. */
const PARSE_ERROR = new Error("when: parse error");

/**
 * Рекурсивный спуск по грамматике upstream `Parser`:
 * `or := and ('||' and)*`, `and := term ('&&' term)*`,
 * `term := '!' (KEY | true | false | '(' or ')') | primary`,
 * `primary := true | false | '(' or ')' | KEY [op value | '=~' REGEX | 'not' 'in' value]`.
 * Без восстановления после ошибок: любая ошибка — `undefined`. Лексему `eof`
 * парсер никогда не потребляет, поэтому курсор не выходит за массив.
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
                // Как у upstream: `a == true` — это `a`, а `a == 'true'` — сравнение со строкой.
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

    /** Правая часть оператора. Пустая (`foo == `) допустима — так пишут существующие расширения. */
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
        // Флаги g и y делают `test` состоятельным — upstream их снимает.
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

/**
 * Разбирает when-строку; при ошибке лексики или синтаксиса — `undefined`.
 * Отдельной проверки лексем `error` нет: ни одно правило грамматики их не
 * принимает, так что разбор на них и так падает.
 */
// Stryker disable BlockStatement: эквивалентный — пустой catch тоже даёт undefined
export function parseWhen(input: string): ContextKeyExpression | undefined {
    try {
        return new Parser(scanWhen(input)).parse();
    } catch {
        return undefined;
    }
}
// Stryker restore BlockStatement

/**
 * Кэш разбора по строке. Общий на модуль законно: результат — чистая функция
 * строки, дерево неизменяемо, а набор строк ограничен регистрациями (встроенные
 * экшены, бинды расширений и `keybindings.json`), так что вытеснение не нужно.
 */
const parseCache = new Map<string, ContextKeyExpression | undefined>();

/** {@link parseWhen} с кэшем: каждая строка разбирается один раз за процесс. */
export function deserializeWhen(input: string): ContextKeyExpression | undefined {
    if (parseCache.has(input)) return parseCache.get(input);
    const expr = parseWhen(input);
    parseCache.set(input, expr);
    return expr;
}

/** Вычисляет выражение над контекстом. Семантика узлов — upstream (loose `==`, `parseFloat` в сравнениях). */
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
    // Stryker disable next-line ConditionalExpression,StringLiteral: эквивалентный — нечисловая правая часть и так даёт сравнение с NaN-ом в ложь; ветка — для типов и читателя
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

/**
 * Текст значения для регекса и сравнений. Скаляр и `undefined` — как `String()`
 * у upstream; у массива и объекта (значения для `in`) текста нет — пустая строка.
 */
function scalarText(value: ContextKeyValue): string {
    return typeof value === "object" ? "" : String(value);
}

function isIn(item: ContextKeyValue, source: ContextKeyValue): boolean {
    if (Array.isArray(source)) return (source as readonly unknown[]).includes(item);
    if (typeof item === "string" && typeof source === "object") return Object.hasOwn(source, item);
    return false;
}

/** Все ключи, на которые ссылается выражение (в любой позиции), без повторов. */
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

/**
 * Ключи, которые выражение требует истинными или сравнивает, — то есть стоящие
 * не под отрицанием (`!a`, `!(a && b)`, `a not in b`). Нужно потребителю,
 * которому важно «бинд живёт при фокусе в X», а не «выражение упоминает X».
 */
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

/**
 * Каноническая запись выражения: лишние скобки и пробелы сняты, операнды
 * `&&`/`||` упорядочены, так что `b && a`, `(a) && b` и `a&&b` пишутся одинаково.
 * Строки — в одинарных кавычках, как у upstream.
 */
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

/** Операнды `&&`/`||` с раскрытыми вложенными узлами того же типа: `a && (b && c)` → `[a, b, c]`. */
function flatten(expr: Extract<ContextKeyExpression, { type: "and" | "or" }>): ContextKeyExpression[] {
    return expr.exprs.flatMap((child) => (child.type === expr.type ? flatten(child) : [child]));
}
