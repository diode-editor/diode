import * as path from "node:path";

/**
 * Индекс «корень расширения на ФС → id расширения» — по нему субпроцесс узнаёт,
 * чей модуль сделал `require("vscode")`/`import "vscode"` (аналог
 * `ExtensionPaths` эталона, `extHostExtensionService.ts`).
 *
 * Поиск — самый длинный корень, который является ПРЕДКОМ пути по сегментам:
 * `/a/foo` матчит `/a/foo/x.js`, но не `/a/foobar/x.js`. Вложенное расширение
 * (корень внутри корня другого) выигрывает у внешнего.
 */
export class ExtensionPaths {
    private readonly roots = new Map<string, string>();
    private readonly realpath: (p: string) => string;

    /**
     * @param options.realpath — разворачивает симлинки корня (node-сторона,
     *   `fs.realpathSync.native`). Модули Node грузит по РЕАЛЬНОМУ пути
     *   (`parent.filename`, `parentURL`), а каталог расширения может лежать за
     *   симлинком — поэтому корень индексируется под обоими именами. Сбой
     *   (`ENOENT` у синтетического пути builtin'а) — индексируем только как есть.
     */
    public constructor(options: { readonly realpath?: (p: string) => string } = {}) {
        // Stryker disable next-line ArrowFunction: эквивалентен — `path.resolve(undefined)` бросает, сбой realpath ловится в add(), и корень индексируется как есть, ровно как с тождественной функцией
        this.realpath = options.realpath ?? ((p) => p);
    }

    public add(root: string, id: string): void {
        const normalized = path.resolve(root);
        this.roots.set(normalized, id);
        try {
            this.roots.set(path.resolve(this.realpath(normalized)), id);
        } catch {
            // Корня нет на диске (синтетический путь builtin'а) — хватит имени как есть.
        }
    }

    /** id расширения, которому принадлежит `fsPath`, или `undefined`. */
    public findByPath(fsPath: string): string | undefined {
        let candidate = path.resolve(fsPath);
        for (;;) {
            const id = this.roots.get(candidate);
            if (id !== undefined) return id;
            const parent = path.dirname(candidate);
            if (parent === candidate) return undefined;
            candidate = parent;
        }
    }
}
