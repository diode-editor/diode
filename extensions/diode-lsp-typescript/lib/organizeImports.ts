/**
 * Organize Imports «как VS Code». Чистая логика (без vscode API) — покрывается
 * юнитами; действие-заглушку строит `main.ts`.
 *
 * Эталонное `typescript-language-features` отдаёт действие «Organize Imports»
 * на ЛЮБОЙ запрос, чей `only` его включает, не спрашивая tsserver: правки
 * считаются лениво в `resolveCodeAction`, и если менять нечего (импорты уже
 * упорядочены, CommonJS `require()`, импортов нет) — действие применяется
 * вхолостую, человек ничего не видит. Стоковый `typescript-language-server`
 * считает правки сразу и при пустом ответе tsserver'а действия не отдаёт
 * вовсе (`provideOrganizeImports` → `[]`), и редактор пишет «No organize
 * imports action» на любом аккуратном файле. Клиент возвращает эталонную
 * форму: нет действия от сервера — добавляет холостое.
 */

/** Вид действия сервера (и эталона): `source.organizeImports` + подвид языка. */
export const ORGANIZE_IMPORTS_TS_KIND = "source.organizeImports.ts";

const ORGANIZE_IMPORTS_KIND = "source.organizeImports";

/**
 * Иерархический матч видов, как `HierarchicalKind.contains` эталона: пустой
 * вид — предок всех, иначе `parent` равен `kind` или его префикс по точке.
 */
function kindContains(parent: string, kind: string): boolean {
    return parent === "" || parent === kind || kind.startsWith(`${parent}.`);
}

/**
 * Нужна ли холостая «Organize Imports»: запрос её включает (`only` — предок
 * или сам `source.organizeImports.ts`, как `context.only?.contains` эталона;
 * без `only` эталон её не отдаёт), а среди видов ответа сервера organize
 * imports нет.
 */
export function needsNoopOrganizeImports(only: string | undefined, kinds: readonly (string | undefined)[]): boolean {
    if (only === undefined || !kindContains(only, ORGANIZE_IMPORTS_TS_KIND)) return false;
    return !kinds.some((kind) => kind !== undefined && kindContains(ORGANIZE_IMPORTS_KIND, kind));
}
