/**
 * Case is preserved for user-facing messages; junk is dropped silently: only the manifest editor
 * checks the upstream schema (`uniqueItems`/`pattern`).
 */
export function readExtensionDependencies(manifest: Readonly<Record<string, unknown>>): readonly string[] {
    const raw = manifest.extensionDependencies;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string" || item === "") continue;
        const key = extensionKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item);
    }
    return result;
}

export function extensionFriendlyName(id: string, manifest: Readonly<Record<string, unknown>>): string {
    const displayName = manifest.displayName;
    return typeof displayName === "string" && displayName !== "" ? displayName : id;
}

/** Like upstream `ExtensionIdentifier.toKey`: `"Redhat.Java"` is the same dependency as `redhat.java`. */
export function extensionKey(id: string): string {
    return id.toLowerCase();
}

/**
 * Deviation from upstream: a missing `vscode.*` dependency breaks neither activation nor install.
 * Upstream ships them as part of the product; we lack many (`git` is `diode.git`) and they aren't
 * in the marketplace. The stock Supermaven depends on `vscode.git` and works without it.
 */
export function isBuiltinVSCodeExtension(id: string): boolean {
    return extensionKey(id).startsWith("vscode.");
}

/**
 * Chain from `startId` back to itself (`["a", "b", "a"]`). `dependenciesOf` returns `undefined`
 * for an unknown id, and the walk doesn't continue through it. Cycles without `startId` are not
 * searched: each participating extension learns about the cycle on its own activation (upstream
 * drops them from the registry entirely).
 */
export function findDependencyLoop(
    startId: string,
    dependenciesOf: (key: string) => readonly string[] | undefined,
): readonly string[] | null {
    const start = extensionKey(startId);
    // The start doesn't need to be in `visited`: a return to it is checked earlier.
    const visited = new Set<string>();
    const walk = (key: string, chain: readonly string[]): readonly string[] | null => {
        const deps = dependenciesOf(key);
        if (deps === undefined) return null;
        for (const dep of deps) {
            const depKey = extensionKey(dep);
            if (depKey === start) return [...chain, dep];
            if (visited.has(depKey)) continue;
            visited.add(depKey);
            const loop = walk(depKey, [...chain, dep]);
            if (loop !== null) return loop;
        }
        return null;
    };
    return walk(start, [startId]);
}
