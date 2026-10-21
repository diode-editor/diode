/**
 * Like upstream `scanner.ts`: strings use single quotes only; anything word-like
 * (a key or an unquoted value: `java`, `.ts`, `foo.bar:baz`) is `str`.
 */
export type WhenToken =
    | {
          readonly type: "(" | ")" | "!" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "=~" | "&&" | "||";
          readonly offset: number;
      }
    | { readonly type: "true" | "false" | "in" | "not" | "eof"; readonly offset: number }
    | { readonly type: "str" | "quotedStr" | "regexStr" | "error"; readonly offset: number; readonly lexeme: string };

const KEYWORDS = new Map<string, "true" | "false" | "in" | "not">([
    ["not", "not"],
    ["in", "in"],
    ["false", "false"],
    ["true", "true"],
]);

const REGEX_FLAGS = new Set(["i", "g", "s", "m", "y", "u"]);

/** A double quote is part of a word, like upstream: `a == "x"` compares with `"x"` including the quotes. */
const WORD_RE = /[a-zA-Z0-9_<>\-./\\:*?+[\]^,#@;"%$\p{L}-]+/uy;

/** The last token is always `eof`. */
export function scanWhen(input: string): WhenToken[] {
    const tokens: WhenToken[] = [];
    let current = 0;
    let start = 0;

    const match = (expected: string): boolean => {
        if (input[current] !== expected) return false;
        current++;
        return true;
    };
    const push = (type: "(" | ")" | "!" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "=~" | "&&" | "||"): void => {
        tokens.push({ type, offset: start });
    };
    const error = (): void => {
        tokens.push({ type: "error", offset: start, lexeme: input.substring(start, current) });
    };

    // Stryker disable next-line EqualityOperator: equivalent, an extra step past the end reads undefined, which matches no rule and is skipped
    while (current < input.length) {
        start = current;
        const ch = input[current++];
        switch (ch) {
            case "(":
                push("(");
                break;
            case ")":
                push(")");
                break;
            case "!":
                if (match("=")) {
                    match("="); // `!==` is the same as `!=`
                    push("!=");
                } else {
                    push("!");
                }
                break;
            case "'": {
                const close = input.indexOf("'", current);
                if (close === -1) {
                    current = input.length;
                    error();
                } else {
                    current = close + 1;
                    tokens.push({ type: "quotedStr", offset: start + 1, lexeme: input.substring(start + 1, close) });
                }
                break;
            }
            case "/": {
                const end = scanRegex(input, current);
                if (end === undefined) {
                    current = input.length;
                    error();
                } else {
                    current = end;
                    tokens.push({ type: "regexStr", offset: start, lexeme: input.substring(start, current) });
                }
                break;
            }
            case "=":
                if (match("=")) {
                    match("="); // `===` is the same as `==`
                    push("==");
                } else if (match("~")) {
                    push("=~");
                } else {
                    error();
                }
                break;
            case "<":
                push(match("=") ? "<=" : "<");
                break;
            case ">":
                push(match("=") ? ">=" : ">");
                break;
            case "&":
                if (match("&")) push("&&");
                else error();
                break;
            case "|":
                if (match("|")) push("||");
                else error();
                break;
            default: {
                WORD_RE.lastIndex = start;
                const word = WORD_RE.exec(input);
                if (word === null) {
                    // Characters outside the word class (`{`, `~`, …) are skipped, like upstream.
                    break;
                }
                current = start + word[0].length;
                const keyword = KEYWORDS.get(word[0]);
                if (keyword !== undefined) tokens.push({ type: keyword, offset: start });
                else tokens.push({ type: "str", offset: start, lexeme: word[0] });
            }
        }
    }
    tokens.push({ type: "eof", offset: input.length });
    return tokens;
}

/** Position past the flags; a `/` inside a character class does not close the regex. */
function scanRegex(input: string, from: number): number | undefined {
    let p = from;
    let inEscape = false;
    let inClass = false;
    // Stryker disable next-line EqualityOperator: equivalent, a step past the end reads undefined, no branch takes it, and the loop exits on the next step
    while (p < input.length) {
        const ch = input[p++];
        if (inEscape) {
            inEscape = false;
        } else if (ch === "/" && !inClass) {
            while (REGEX_FLAGS.has(input[p])) p++;
            return p;
        } else if (ch === "[") {
            inClass = true;
        } else if (ch === "\\") {
            inEscape = true;
        } else if (ch === "]") {
            inClass = false;
        }
    }
    return undefined;
}
