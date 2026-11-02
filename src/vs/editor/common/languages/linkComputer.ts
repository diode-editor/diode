import { CharCode } from "../../../base/common/charCode.ts";
import { CharacterClassifier } from "../core/characterClassifier.ts";

import type { ILink } from "./iLinkSource.ts";

/** What the computer reads of a document; `ITextDocument` fits as is. */
export interface ILinkComputerTarget {
    readonly lineCount: number;
    getLineContent(line: number): string;
}

const enum State {
    Invalid = 0,
    Start = 1,
    H = 2,
    HT = 3,
    HTT = 4,
    HTTP = 5,
    F = 6,
    FI = 7,
    FIL = 8,
    BeforeColon = 9,
    AfterColon = 10,
    AlmostThere = 11,
    End = 12,
    Accept = 13,
}

/** Upstream's automaton for `http://`, `https://` and `file://`, in any case. */
const EDGES: readonly (readonly [State, string, State])[] = [
    [State.Start, "h", State.H],
    [State.Start, "f", State.F],
    [State.H, "t", State.HT],
    [State.HT, "t", State.HTT],
    [State.HTT, "p", State.HTTP],
    [State.HTTP, "s", State.BeforeColon],
    [State.HTTP, ":", State.AfterColon],
    [State.F, "i", State.FI],
    [State.FI, "l", State.FIL],
    [State.FIL, "e", State.BeforeColon],
    [State.BeforeColon, ":", State.AfterColon],
    [State.AfterColon, "/", State.AlmostThere],
    [State.AlmostThere, "/", State.End],
];

function edgeKey(state: State, charCode: number): number {
    return state * 0x10000 + charCode;
}

const TRANSITIONS = new Map<number, State>(
    EDGES.flatMap(([from, char, to]) => [
        [edgeKey(from, char.charCodeAt(0)), to] as const,
        [edgeKey(from, char.toUpperCase().charCodeAt(0)), to] as const,
    ]),
);

const enum CharacterClass {
    None = 0,
    ForceTermination = 1,
    CannotEndIn = 2,
}

const FORCE_TERMINATION_CHARACTERS = " \t<>'\"、。｡､，．：；‘〈「『〔（［｛｢｣｝］）〕』」〉’｀～…|";
const CANNOT_END_WITH_CHARACTERS = ".,;:";

const classifier = new CharacterClassifier<CharacterClass>(CharacterClass.None);
for (const char of FORCE_TERMINATION_CHARACTERS) classifier.set(char.charCodeAt(0), CharacterClass.ForceTermination);
for (const char of CANNOT_END_WITH_CHARACTERS) classifier.set(char.charCodeAt(0), CharacterClass.CannotEndIn);

function createLink(line: string, lineNumber: number, linkBeginIndex: number, linkEndIndex: number): ILink {
    // Do not allow to end link in certain characters...
    let lastIncludedCharIndex = linkEndIndex - 1;
    do {
        if (classifier.get(line.charCodeAt(lastIncludedCharIndex)) !== CharacterClass.CannotEndIn) break;
        lastIncludedCharIndex--;
    } while (lastIncludedCharIndex > linkBeginIndex);

    // Handle links enclosed in parens, square brackets and curlys.
    if (linkBeginIndex > 0) {
        const charCodeBeforeLink = line.charCodeAt(linkBeginIndex - 1) as CharCode;
        const lastCharCodeInLink = line.charCodeAt(lastIncludedCharIndex) as CharCode;
        if (
            (charCodeBeforeLink === CharCode.OpenParen && lastCharCodeInLink === CharCode.CloseParen) ||
            (charCodeBeforeLink === CharCode.OpenSquareBracket && lastCharCodeInLink === CharCode.CloseSquareBracket) ||
            (charCodeBeforeLink === CharCode.OpenCurlyBrace && lastCharCodeInLink === CharCode.CloseCurlyBrace)
        ) {
            lastIncludedCharIndex--;
        }
    }

    return {
        range: {
            start: { line: lineNumber, character: linkBeginIndex },
            end: { line: lineNumber, character: lastIncludedCharIndex + 1 },
        },
        url: line.substring(linkBeginIndex, lastIncludedCharIndex + 1),
    };
}

/**
 * Port of upstream `LinkComputer.computeLinks`, over the lines `[from, to)`; positions are 0-based. A link never
 * crosses a line, so the links of the slices together are those of the document. Upstream's guard against a `null`
 * model is for callers from a worker message, and its pluggable automaton has no second user here.
 */
export function computeLinks(model: ILinkComputerTarget, from = 0, to = model.lineCount): ILink[] {
    const result: ILink[] = [];
    for (let i = from; i < to; i++) {
        const line = model.getLineContent(i);
        // Stryker disable next-line ConditionalExpression,BlockStatement: a shortcut for the usual line; the automaton finds nothing in it anyway
        if (!line.includes("://")) continue;
        const len = line.length;

        let j = 0;
        let linkBeginIndex = 0;
        let linkBeginChCode = CharCode.Null;
        let state: State = State.Start;
        let hasOpenParens = false;
        let hasOpenSquareBracket = false;
        let inSquareBrackets = false;
        let hasOpenCurlyBracket = false;

        while (j < len) {
            let resetStateMachine = false;
            const chCode = line.charCodeAt(j) as CharCode;

            if (state === State.Accept) {
                let chClass: CharacterClass;
                switch (chCode) {
                    case CharCode.OpenParen:
                        hasOpenParens = true;
                        chClass = CharacterClass.None;
                        break;
                    case CharCode.CloseParen:
                        chClass = hasOpenParens ? CharacterClass.None : CharacterClass.ForceTermination;
                        break;
                    case CharCode.OpenSquareBracket:
                        inSquareBrackets = true;
                        hasOpenSquareBracket = true;
                        chClass = CharacterClass.None;
                        break;
                    case CharCode.CloseSquareBracket:
                        inSquareBrackets = false;
                        chClass = hasOpenSquareBracket ? CharacterClass.None : CharacterClass.ForceTermination;
                        break;
                    case CharCode.OpenCurlyBrace:
                        hasOpenCurlyBracket = true;
                        chClass = CharacterClass.None;
                        break;
                    case CharCode.CloseCurlyBrace:
                        chClass = hasOpenCurlyBracket ? CharacterClass.None : CharacterClass.ForceTermination;
                        break;
                    // ' or " or ` are allowed inside links only if the link is wrapped by some other quote character.
                    case CharCode.SingleQuote:
                    case CharCode.DoubleQuote:
                    case CharCode.BackTick:
                        if (linkBeginChCode === chCode) {
                            chClass = CharacterClass.ForceTermination;
                        } else if (
                            linkBeginChCode === CharCode.SingleQuote ||
                            linkBeginChCode === CharCode.DoubleQuote ||
                            linkBeginChCode === CharCode.BackTick
                        ) {
                            chClass = CharacterClass.None;
                        } else {
                            chClass = CharacterClass.ForceTermination;
                        }
                        break;
                    case CharCode.Asterisk:
                        // `*` terminates a link if the link began with `*`.
                        chClass =
                            linkBeginChCode === CharCode.Asterisk
                                ? CharacterClass.ForceTermination
                                : CharacterClass.None;
                        break;
                    case CharCode.Space:
                        // A space is allowed in between [ and ].
                        chClass = inSquareBrackets ? CharacterClass.None : CharacterClass.ForceTermination;
                        break;
                    default:
                        chClass = classifier.get(chCode);
                }

                if (chClass === CharacterClass.ForceTermination) {
                    result.push(createLink(line, i, linkBeginIndex, j));
                    resetStateMachine = true;
                }
            } else if (state === State.End) {
                // The authority part may be an IPv6 address, which contains [ and ].
                const chClass = chCode === CharCode.OpenSquareBracket ? CharacterClass.None : classifier.get(chCode);
                if (chCode === CharCode.OpenSquareBracket) hasOpenSquareBracket = true;

                if (chClass === CharacterClass.ForceTermination) {
                    resetStateMachine = true;
                } else {
                    state = State.Accept;
                }
            } else {
                state = TRANSITIONS.get(edgeKey(state, chCode)) ?? State.Invalid;
                if (state === State.Invalid) resetStateMachine = true;
            }

            if (resetStateMachine) {
                state = State.Start;
                hasOpenParens = false;
                hasOpenSquareBracket = false;
                hasOpenCurlyBracket = false;
                // Record where the link started.
                linkBeginIndex = j + 1;
                linkBeginChCode = chCode;
            }

            j++;
        }

        if (state === State.Accept) result.push(createLink(line, i, linkBeginIndex, len));
    }
    return result;
}
