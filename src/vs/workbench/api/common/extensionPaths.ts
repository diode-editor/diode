import * as path from "node:path";

/**
 * Roots match by segment: `/a/foo` is an ancestor of `/a/foo/x.js` but not of
 * `/a/foobar/x.js`; a nested extension wins over the enclosing one.
 */
export class ExtensionPaths {
    private readonly roots = new Map<string, string>();
    private readonly realpath: (p: string) => string;

    /**
     * Node loads modules by their REAL path, while an extension directory may sit behind
     * a symlink, so the root is indexed under both names.
     */
    public constructor(options: { readonly realpath?: (p: string) => string } = {}) {
        // Stryker disable next-line ArrowFunction: equivalent — `path.resolve(undefined)` throws, a realpath failure is caught in add(), and the root is indexed as is, exactly as with the identity function
        this.realpath = options.realpath ?? ((p) => p);
    }

    public add(root: string, id: string): void {
        const normalized = path.resolve(root);
        this.roots.set(normalized, id);
        try {
            this.roots.set(path.resolve(this.realpath(normalized)), id);
        } catch {
            // The root isn't on disk (a builtin's synthetic path); the name as is suffices.
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
