import * as path from "node:path";

/**
 * Корень матчится по сегментам: `/a/foo` — предок `/a/foo/x.js`, но не
 * `/a/foobar/x.js`; вложенное расширение выигрывает у внешнего.
 */
export class ExtensionPaths {
    private readonly roots = new Map<string, string>();
    private readonly realpath: (p: string) => string;

    /**
     * Node грузит модули по РЕАЛЬНОМУ пути, а каталог расширения может лежать за
     * симлинком, поэтому корень индексируется под обоими именами.
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
