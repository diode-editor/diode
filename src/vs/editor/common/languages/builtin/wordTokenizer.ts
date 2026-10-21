import { ColorId, FontStyle, LanguageId, MetadataConsts, StandardTokenType } from "../../encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../languages.ts";
import { EncodedTokenizationResult } from "../../languages.ts";
import type { IState } from "../iState.ts";
import { NULL_STATE } from "../iState.ts";

const KEYWORDS = new Set([
    "if",
    "else",
    "for",
    "while",
    "do",
    "return",
    "function",
    "const",
    "let",
    "var",
    "class",
    "extends",
    "implements",
    "interface",
    "import",
    "export",
    "from",
    "new",
    "this",
    "super",
    "true",
    "false",
    "null",
    "undefined",
    "void",
    "typeof",
    "instanceof",
    "in",
    "of",
    "throw",
    "try",
    "catch",
    "finally",
    "switch",
    "case",
    "break",
    "continue",
    "default",
    "async",
    "await",
    "yield",
    "static",
    "public",
    "private",
    "protected",
    "readonly",
    "type",
    "enum",
]);

/** colorMap indices: the demo tokenizer has no theme, tests give the resolver their own colorMap. */
export const WordTokenColor = {
    keyword: 3,
    number: 4,
    string: 5,
    comment: 6,
} as const;

function metadata(foreground: number, tokenType: StandardTokenType): number {
    return (
        ((LanguageId.Null << MetadataConsts.LANGUAGEID_OFFSET) |
            (tokenType << MetadataConsts.TOKEN_TYPE_OFFSET) |
            (FontStyle.None << MetadataConsts.FONT_STYLE_OFFSET) |
            (foreground << MetadataConsts.FOREGROUND_OFFSET) |
            (ColorId.DefaultBackground << MetadataConsts.BACKGROUND_OFFSET)) >>>
        0
    );
}

const KEYWORD = metadata(WordTokenColor.keyword, StandardTokenType.Other);
const NUMBER = metadata(WordTokenColor.number, StandardTokenType.Other);
const STRING = metadata(WordTokenColor.string, StandardTokenType.String);
const COMMENT = metadata(WordTokenColor.comment, StandardTokenType.Comment);
const TEXT = metadata(ColorId.DefaultForeground, StandardTokenType.Other);

function isIdentStart(ch: string): boolean {
    return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$";
}

function isIdentPart(ch: string): boolean {
    return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
}

/** For demos and tests. Adjacent tokens of the same type are merged, as in `tokenizeLine2`. */
export class WordTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return NULL_STATE;
    }

    public tokenizeEncoded(line: string, _hasEOL: boolean, _state: IState): EncodedTokenizationResult {
        const tokens: number[] = [];
        const length = line.length;
        let i = 0;

        const push = (start: number, kind: number): void => {
            if (tokens.at(-1) === kind) return;
            tokens.push(start, kind);
        };

        while (i < length) {
            const ch = line[i];

            if (ch === "/" && line[i + 1] === "/") {
                push(i, COMMENT);
                i = length;
                continue;
            }

            if (ch === '"' || ch === "'") {
                push(i, STRING);
                const quote = ch;
                i++;
                while (i < length) {
                    if (line[i] === "\\" && i + 1 < length) {
                        i += 2;
                        continue;
                    }
                    const stop = line[i] === quote;
                    i++;
                    if (stop) break;
                }
                continue;
            }

            if (isDigit(ch)) {
                push(i, NUMBER);
                while (i < length && (isDigit(line[i]) || line[i] === ".")) i++;
                continue;
            }

            if (isIdentStart(ch)) {
                const start = i;
                while (i < length && isIdentPart(line[i])) i++;
                const word = line.substring(start, i);
                push(start, KEYWORDS.has(word) ? KEYWORD : TEXT);
                continue;
            }

            push(i, TEXT);
            i++;
        }

        if (tokens.length === 0) {
            tokens.push(0, TEXT);
        }

        // Stryker disable next-line ArrayDeclaration: tokens have no fonts, nobody reads the array
        return new EncodedTokenizationResult(new Uint32Array(tokens), [], NULL_STATE);
    }
}
