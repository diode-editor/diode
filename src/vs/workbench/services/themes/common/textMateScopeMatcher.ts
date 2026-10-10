/**
 * Матчер TextMate-селекторов правил темы — перенос
 * `vs/workbench/services/themes/common/textMateScopeMatcher.ts` эталона.
 * Грамматика: дизъюнкция через `,`/`|`, конъюнкция — пробел (путь скоупов),
 * отрицание `-`, скобки, приоритеты `L:`/`R:` (пропускаются).
 *
 * Им пользуется фоллбэк семантического токена на TM-скоупы
 * (`SemanticTokenStyleResolver.resolveScopes`); подсветку TextMate по-прежнему
 * красит `TokenThemeResolver` с его longest-prefix-матчем.
 */

export type Matcher<T> = (matcherInput: T) => number;

/**
 * Матчеры альтернатив селектора (через `,`) — в `results`. Поле `priority`
 * эталона опущено: единственный его потребитель здесь, как и `resolveScopes`
 * эталона, приоритет не читает.
 */
export function createMatchers<T>(
    selector: string,
    matchesName: (names: readonly string[], matcherInput: T) => number,
    results: Matcher<T>[],
): void {
    const tokenizer = newTokenizer(selector);
    let token = tokenizer.next();
    while (token !== null) {
        if (token.length === 2 && token.endsWith(":")) {
            token = tokenizer.next(); // приоритет L:/R:
        }
        const matcher = parseConjunction();
        if (matcher) {
            results.push(matcher);
        }
        if (token !== ",") {
            break;
        }
        token = tokenizer.next();
    }

    function parseOperand(): Matcher<T> | null {
        if (token === "-") {
            token = tokenizer.next();
            const expressionToNegate = parseOperand();
            if (!expressionToNegate) {
                return null;
            }
            return (matcherInput) => (expressionToNegate(matcherInput) < 0 ? 0 : -1);
        }
        if (token === "(") {
            token = tokenizer.next();
            const expressionInParents = parseInnerExpression();
            // После скобочного выражения токен — либо ")", либо конец строки:
            // безусловный next() на null дал бы тот же null.
            // Stryker disable next-line ConditionalExpression: см. выше — эквивалентен
            if (token === ")") {
                token = tokenizer.next();
            }
            return expressionInParents;
        }
        if (isIdentifier(token)) {
            const identifiers: string[] = [];
            do {
                identifiers.push(token);
                token = tokenizer.next();
            } while (isIdentifier(token));
            return (matcherInput) => matchesName(identifiers, matcherInput);
        }
        return null;
    }

    function parseConjunction(): Matcher<T> | null {
        let matcher = parseOperand();
        if (!matcher) {
            return null;
        }
        const matchers: Matcher<T>[] = [];
        while (matcher) {
            matchers.push(matcher);
            matcher = parseOperand();
        }
        return (matcherInput) => {
            // and
            let min = matchers[0](matcherInput);
            // Stryker disable next-line ConditionalExpression: ранний выход — оптимизация, min от отрицательного не растёт
            for (let i = 1; min >= 0 && i < matchers.length; i++) {
                min = Math.min(min, matchers[i](matcherInput));
            }
            return min;
        };
    }

    function parseInnerExpression(): Matcher<T> | null {
        let matcher = parseConjunction();
        if (!matcher) {
            return null;
        }
        const matchers: Matcher<T>[] = [];
        while (matcher) {
            matchers.push(matcher);
            if (token === "|" || token === ",") {
                do {
                    token = tokenizer.next();
                } while (token === "|" || token === ","); // ignore subsequent commas
            } else {
                break;
            }
            matcher = parseConjunction();
        }
        return (matcherInput) => {
            // or
            let max = matchers[0](matcherInput);
            for (let i = 1; i < matchers.length; i++) {
                max = Math.max(max, matchers[i](matcherInput));
            }
            return max;
        };
    }
}

function isIdentifier(token: string | null): token is string {
    // Stryker disable next-line Regex: «хотя бы один символ» и «один символ» для test() неразличимы
    return token !== null && /[\w.:]+/.test(token);
}

function newTokenizer(input: string): { next: () => string | null } {
    const regex = /([LR]:|[\w.:][\w.:-]*|[,|\-()])/g;
    let match = regex.exec(input);
    return {
        next: () => {
            if (!match) {
                return null;
            }
            const res = match[0];
            match = regex.exec(input);
            return res;
        },
    };
}
