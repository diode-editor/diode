/**
 * Регистр сохраняется для сообщений человеку; мусор отброшен молча — схему
 * эталона (`uniqueItems`/`pattern`) проверяет только редактор манифеста.
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

/** Как `ExtensionIdentifier.toKey` эталона: `"Redhat.Java"` — та же зависимость, что `redhat.java`. */
export function extensionKey(id: string): string {
    return id.toLowerCase();
}

/**
 * Отступление от эталона: отсутствующая зависимость на `vscode.*` не срывает
 * ни активацию, ни установку. У эталона они часть продукта, у нас многих нет
 * (`git` — `diode.git`), а в магазине их не взять; стоковый Supermaven зависит
 * от `vscode.git` и без него работает.
 */
export function isBuiltinVSCodeExtension(id: string): boolean {
    return extensionKey(id).startsWith("vscode.");
}

/**
 * Цепочка от `startId` обратно к нему (`["a", "b", "a"]`). `dependenciesOf`
 * отдаёт `undefined` для неизвестного — по нему цикл не продолжается. Циклы без
 * `startId` не ищутся: каждое участвующее расширение узнает о цикле на своей
 * активации (у эталона они выпадают из реестра целиком).
 */
export function findDependencyLoop(
    startId: string,
    dependenciesOf: (key: string) => readonly string[] | undefined,
): readonly string[] | null {
    const start = extensionKey(startId);
    // Стартовое в `visited` не нужно: возврат к нему проверяется раньше.
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
