import type { IPosition } from "../../common/core/iPosition.ts";
import { standardTokenTypeAt } from "../../common/languages/standardTokenType.ts";
import type { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";

import type { IsCodeAt } from "./bracketSelections.ts";

/**
 * Скобки в строках и комментариях пару не образуют (эталон судит по токенам
 * TextMate). Строки до самой нижней каретки размечаются, как у рендера; у
 * строк за фронтиром токенизации токенов нет или они устарели — их скобки
 * считаются кодом. Без грамматики (`store` нет) код — всё.
 */
export function tokenCodeAt(store: DocumentTokenStore | undefined, positions: readonly IPosition[]): IsCodeAt {
    if (store === undefined) return () => true;
    store.tokenizeUpTo(Math.max(...positions.map((position) => position.line)));
    return (line, character) =>
        // Stryker disable next-line EqualityOperator: кэш самой строки invalidLineIndex всегда пуст (правка его чистит, фронтир не считан) — пусто и есть «код»
        line >= store.invalidLineIndex || standardTokenTypeAt(store.getLineTokens(line), character) === "other";
}
