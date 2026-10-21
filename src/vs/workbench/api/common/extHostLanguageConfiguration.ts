import type * as vscode from "vscode";

import { regExpMatchesEmptyString } from "../../../editor/common/core/wordHelper.ts";
import type {
    IAutoClosingPair,
    ICommentRule,
    ILanguageConfiguration,
} from "../../../platform/extensions/common/iLanguageConfiguration.ts";

import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { DisposableImpl, SyntaxTokenType } from "./vscodeTypes.ts";

/**
 * По эталону: `wordPattern` живёт в субпроцессе; `comments`/`brackets`/
 * `autoClosingPairs` уезжают хосту слоем поверх `language-configuration.json`
 * (dispose снимает слой, но — как у эталона — не определение слова); прочие
 * секции принимаются и не применяются — ядро их не умеет.
 */
export function createSetLanguageConfiguration(
    ctx: IVscodeHostContext,
): (language: string, configuration: vscode.LanguageConfiguration) => vscode.Disposable {
    let nextHandle = 0;
    return (language, configuration) => {
        const { wordPattern } = configuration;
        // Эталон проверяет truthy-значение: `wordPattern: undefined` снимает определение.
        if (wordPattern !== undefined && regExpMatchesEmptyString(wordPattern)) {
            throw new Error(
                `Invalid language configuration: wordPattern '${String(wordPattern)}' is not allowed to match the empty string.`,
            );
        }
        ctx.registry.setWordDefinitionFor(language, wordPattern);

        const handle = nextHandle++;
        ctx.rpc.notify("languages.setLanguageConfiguration", {
            handle,
            languageId: language,
            configuration: toWireConfiguration(configuration),
        });
        return new DisposableImpl(() => {
            ctx.rpc.notify("languages.unsetLanguageConfiguration", { handle });
        });
    };
}

function toWireConfiguration(configuration: vscode.LanguageConfiguration): ILanguageConfiguration {
    const { comments, brackets, autoClosingPairs } = configuration;
    return {
        ...(comments === undefined ? {} : { comments: toWireComments(comments) }),
        ...(brackets === undefined ? {} : { brackets }),
        ...(autoClosingPairs === undefined ? {} : { autoClosingPairs: autoClosingPairs.map(toWireAutoClosingPair) }),
    };
}

/** Ядро знает только сам маркер — `noIndent` не применяется. */
function toWireComments(comments: vscode.CommentRule): ICommentRule {
    const { lineComment, blockComment } = comments;
    return {
        lineComment: typeof lineComment === "object" ? lineComment.comment : lineComment,
        blockComment,
    };
}

/** Ядро различает только строки и комментарии; `regex`/`other` отбрасываются. */
function toWireAutoClosingPair(pair: vscode.AutoClosingPair): IAutoClosingPair {
    const notIn: ("string" | "comment")[] = [];
    // Stryker disable next-line ArrayDeclaration: фолбэк-массив пуст по смыслу — любой не-SyntaxTokenType элемент отсеялся бы ниже, наблюдаемо то же
    for (const kind of pair.notIn ?? []) {
        if ((kind as number) === (SyntaxTokenType.String as number)) notIn.push("string");
        else if ((kind as number) === (SyntaxTokenType.Comment as number)) notIn.push("comment");
    }
    return { open: pair.open, close: pair.close, notIn };
}
