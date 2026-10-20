import type { IPosition } from "../../common/core/iPosition.ts";
import { standardTokenTypeAt } from "../../common/languages/standardTokenType.ts";
import type { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";

import type { IsCodeAt } from "./bracketSelections.ts";

/**
 * Скобки в строках и комментариях пару не образуют (эталон судит по токенам
 * TextMate). Строки до самой нижней каретки доводятся точно
 * (`forceTokenization` — явная команда, ей можно); у строк за ними токены
 * эвристические или устаревшие — их скобки считаются кодом. Без грамматики
 * (`store` нет) код — всё.
 */
export function tokenCodeAt(store: DocumentTokenStore | undefined, positions: readonly IPosition[]): IsCodeAt {
    if (store === undefined) return () => true;
    store.forceTokenization(Math.max(...positions.map((position) => position.line)));
    return (line, character) =>
        !store.hasAccurateTokensForLine(line) || standardTokenTypeAt(store.getLineTokens(line), character) === "other";
}
