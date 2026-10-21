import type { IPosition } from "../../common/core/iPosition.ts";
import { standardTokenTypeAt } from "../../common/languages/standardTokenType.ts";
import type { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";

import type { IsCodeAt } from "./bracketSelections.ts";

/**
 * `forceTokenization` up to the lowest cursor is fine for an explicit command; lines past it
 * have heuristic or stale tokens, so their brackets count as code.
 */
export function tokenCodeAt(store: DocumentTokenStore | undefined, positions: readonly IPosition[]): IsCodeAt {
    if (store === undefined) return () => true;
    store.forceTokenization(Math.max(...positions.map((position) => position.line)));
    return (line, character) =>
        !store.hasAccurateTokensForLine(line) || standardTokenTypeAt(store.getLineTokens(line), character) === "other";
}
