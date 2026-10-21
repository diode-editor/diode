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
 * As upstream: `wordPattern` lives in the subprocess; `comments`/`brackets`/
 * `autoClosingPairs` go to the host as a layer over `language-configuration.json`
 * (dispose removes the layer but, as upstream, not the word definition); other
 * sections are accepted and ignored since the core does not support them.
 */
export function createSetLanguageConfiguration(
    ctx: IVscodeHostContext,
): (language: string, configuration: vscode.LanguageConfiguration) => vscode.Disposable {
    let nextHandle = 0;
    return (language, configuration) => {
        const { wordPattern } = configuration;
        // Upstream checks for a truthy value: `wordPattern: undefined` removes the definition.
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

/** The core knows only the marker itself; `noIndent` is not applied. */
function toWireComments(comments: vscode.CommentRule): ICommentRule {
    const { lineComment, blockComment } = comments;
    return {
        lineComment: typeof lineComment === "object" ? lineComment.comment : lineComment,
        blockComment,
    };
}

/** The core distinguishes only strings and comments; `regex`/`other` are dropped. */
function toWireAutoClosingPair(pair: vscode.AutoClosingPair): IAutoClosingPair {
    const notIn: ("string" | "comment")[] = [];
    // Stryker disable next-line ArrayDeclaration: the fallback array is empty by design — any non-SyntaxTokenType element would be filtered out below, observably the same
    for (const kind of pair.notIn ?? []) {
        if ((kind as number) === (SyntaxTokenType.String as number)) notIn.push("string");
        else if ((kind as number) === (SyntaxTokenType.Comment as number)) notIn.push("comment");
    }
    return { open: pair.open, close: pair.close, notIn };
}
