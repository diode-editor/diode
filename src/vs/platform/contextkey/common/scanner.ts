/**
 * Лексема when-выражения. Набор и правила — как у upstream
 * `vs/platform/contextkey/common/scanner.ts`: строки только в одинарных кавычках,
 * `/regex/flags`, операторы `== != === !== < <= > >= && || ! =~`, ключевые слова
 * `true false in not`. Всё прочее, что похоже на слово (ключ или значение без
 * кавычек: `editorLangId`, `java`, `.ts`, `foo.bar:baz`), — `str`.
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

/**
 * Символы слова — тот же класс, что у upstream. Двойная кавычка входит в слово
 * (upstream сохраняет так поведение старого парсера: `a == "x"` сравнивает с `"x"`).
 */
const WORD_RE = /[a-zA-Z0-9_<>\-./\\:*?+[\]^,#@;"%$\p{L}-]+/uy;

/**
 * Разбивает when-строку на лексемы; последняя всегда `eof`. Ошибки лексики
 * (одиночные `=`, `&`, `|`, незакрытая кавычка или регекс) становятся лексемой
 * `error` — парсер на ней останавливается. Восстановления после ошибок, как у
 * upstream, нет: битая строка целиком ложна.
 */
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

    // Stryker disable next-line EqualityOperator: эквивалентный — лишний шаг за концом читает undefined, который не входит ни в одно правило и пропускается
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
                    match("="); // `!==` — то же, что `!=`
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
                    match("="); // `===` — то же, что `==`
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
                    // Пробельные символы и символы вне класса слова (`{`, `~`, …)
                    // пропускаются — как у upstream.
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

/**
 * Хвост регекса после открывающего `/`: до неэкранированного `/` вне
 * класса символов, потом флаги. Возвращает позицию за флагами или `undefined`,
 * если закрывающего `/` нет. Слэш внутри регекса экранируется: `/file:\/\//`.
 */
function scanRegex(input: string, from: number): number | undefined {
    let p = from;
    let inEscape = false;
    let inClass = false;
    // Stryker disable next-line EqualityOperator: эквивалентный — шаг за концом читает undefined, ни одна ветка его не берёт, и цикл выходит следующим шагом
    while (p < input.length) {
        const ch = input[p++];
        if (inEscape) {
            inEscape = false;
        } else if (ch === "/" && !inClass) {
            // За концом строки `input[p]` — undefined, его во флагах нет.
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
