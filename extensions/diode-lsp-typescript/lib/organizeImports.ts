/**
 * Эталонное `typescript-language-features` отдаёт «Organize Imports» на любой
 * запрос, чей `only` его включает, а правки считает лениво — менять нечего, и
 * действие применяется вхолостую. Стоковый `typescript-language-server` при пустом
 * ответе tsserver'а действия не отдаёт, и редактор пишет «No organize imports
 * action» на любом аккуратном файле. Возвращаем эталонную форму холостым действием.
 */

export const ORGANIZE_IMPORTS_TS_KIND = "source.organizeImports.ts";

const ORGANIZE_IMPORTS_KIND = "source.organizeImports";

/** Как `HierarchicalKind.contains` эталона. */
function kindContains(parent: string, kind: string): boolean {
    return parent === "" || parent === kind || kind.startsWith(`${parent}.`);
}

/** Без `only` эталон холостое действие не отдаёт. */
export function needsNoopOrganizeImports(only: string | undefined, kinds: readonly (string | undefined)[]): boolean {
    // Stryker disable next-line ConditionalExpression: эквивалентный — без гарда `undefined` доходит до kindContains, и `"source.organizeImports.ts".startsWith("undefined.")` тоже даёт false
    if (only === undefined || !kindContains(only, ORGANIZE_IMPORTS_TS_KIND)) return false;
    return !kinds.some((kind) => kind !== undefined && kindContains(ORGANIZE_IMPORTS_KIND, kind));
}
