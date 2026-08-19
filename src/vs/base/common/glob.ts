/**
 * Мини-glob по пути: компиляция шаблона в `RegExp` и матчинг.
 *
 * Поддержано подмножество синтаксиса VS Code (`GlobPattern` в `vscode.d.ts`),
 * которого хватает нашим потребителям — селекторам документов
 * (`{ pattern: "**\/settings.json" }`) и `files.watcherExclude`:
 * - `*` — любые символы **внутри одного сегмента**;
 * - `**` — любое число сегментов, включая ноль (в форме `**\/` — с ведущим
 *   разделителем, поэтому `**\/x` матчит и просто `x`);
 * - `?` — один символ внутри сегмента;
 * - `{a,b}` — группировка альтернатив.
 *
 * Диапазоны `[0-9]`/`[!0-9]` не поддержаны: в наших шаблонах их нет, а
 * полусделанная поддержка хуже явного отсутствия — квадратная скобка
 * экранируется и матчится буквально.
 *
 * Путь ожидается в posix-форме (разделитель `/`); приводит его к ней вызывающий —
 * только он знает, откуда путь взялся.
 */

/** Скомпилированные шаблоны: матчинг идёт на каждое файловое событие. */
const cache = new Map<string, RegExp>();

/** Компилирует glob в `RegExp`, якорный по всему пути. */
export function globToRegExp(glob: string): RegExp {
    const cached = cache.get(glob);
    if (cached !== undefined) return cached;

    let re = "";
    // Глубина открытых `{…}`: только внутри группы запятая значит альтернативу.
    let groupDepth = 0;
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                i++;
                if (glob[i + 1] === "/") {
                    i++;
                    re += "(?:.*/)?"; // `**/` — ноль и более сегментов пути
                } else {
                    re += ".*";
                }
            } else {
                re += "[^/]*"; // `*` — внутри одного сегмента
            }
        } else if (c === "?") {
            re += "[^/]";
        } else if (c === "{") {
            groupDepth++;
            re += "(?:";
        } else if (c === "}" && groupDepth > 0) {
            groupDepth--;
            re += ")";
        } else if (c === "," && groupDepth > 0) {
            // Запятая — разделитель альтернатив только внутри `{…}`; вне группы
            // это обычный символ имени файла.
            re += "|";
        } else if ("/.+^${}()|[]\\".includes(c)) {
            re += "\\" + c;
        } else {
            re += c;
        }
    }

    const compiled = new RegExp("^" + re + "$");
    cache.set(glob, compiled);
    return compiled;
}

/** Матчит путь (posix-форма) против glob-шаблона. */
export function matchGlob(pattern: string, path: string): boolean {
    return globToRegExp(pattern).test(path);
}

/** Матчит путь хотя бы против одного шаблона; пустой набор не матчит ничего. */
export function matchAnyGlob(patterns: readonly string[], path: string): boolean {
    return patterns.some((pattern) => matchGlob(pattern, path));
}
