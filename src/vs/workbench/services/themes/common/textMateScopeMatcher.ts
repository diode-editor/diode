// Port of upstream `textMateScopeMatcher.ts`. Disjunction is `,`/`|`, conjunction is a space
// (scope path), negation `-`, parentheses; `L:`/`R:` priorities are skipped.

export type Matcher<T> = (matcherInput: T) => number;

/** Upstream's `priority` field is omitted: nothing here reads it (nor does upstream `resolveScopes`). */
export function createMatchers<T>(
    selector: string,
    matchesName: (names: readonly string[], matcherInput: T) => number,
    results: Matcher<T>[],
): void {
    const tokenizer = newTokenizer(selector);
    let token = tokenizer.next();
    // An empty body loops the parser forever: the mutant hangs rather than survives.
    // Stryker disable next-line BlockStatement: see above
    while (token !== null) {
        if (token.length === 2 && token.endsWith(":")) {
            token = tokenizer.next(); // L:/R: priority
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
            // After a parenthesized expression the token is either ")" or end of string:
            // an unconditional next() on null would yield the same null.
            // Stryker disable next-line ConditionalExpression: see above, equivalent
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
            let min = matchers[0](matcherInput);
            // Stryker disable next-line ConditionalExpression: early exit is an optimization, min of a negative does not grow
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
            // A conjunction ends only at "|", ",", ")" or end of string:
            // without break the next parseConjunction at ")"/end returns null.
            // Stryker disable next-line ConditionalExpression: see above, equivalent
            if (token !== "|" && token !== ",") break;
            do {
                token = tokenizer.next();
            } while (token === "|" || token === ",");
            matcher = parseConjunction();
        }
        return (matcherInput) => {
            let max = matchers[0](matcherInput);
            for (let i = 1; i < matchers.length; i++) {
                max = Math.max(max, matchers[i](matcherInput));
            }
            return max;
        };
    }
}

function isIdentifier(token: string | null): token is string {
    // Stryker disable next-line Regex: "at least one char" and "one char" are indistinguishable for test()
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
