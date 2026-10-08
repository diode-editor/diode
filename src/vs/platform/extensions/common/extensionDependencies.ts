/**
 * Разбор `extensionDependencies` манифеста — для активации (`ExtensionHost`):
 * зависимости поднимаются раньше зависимого, как `_handleActivationRequest`
 * эталона (`extHostExtensionActivator.ts`).
 *
 * Id расширений сравниваются без учёта регистра (`ExtensionIdentifier.toKey`
 * эталона): `"Redhat.Java"` в манифесте — та же зависимость, что `redhat.java`.
 */

/**
 * `extensionDependencies` манифеста — как объявлены (регистр сохраняется для
 * сообщений человеку), без дублей по ключу и без мусора: поле не массив или
 * элемент не непустая строка — такого элемента нет (манифест пишем не мы,
 * а `uniqueItems`/`pattern` схемы эталона проверяет только редактор манифеста).
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

/** Имя расширения для сообщений человеку: `displayName` манифеста, иначе id (`friendlyName` эталона). */
export function extensionFriendlyName(id: string, manifest: Readonly<Record<string, unknown>>): string {
    const displayName = manifest.displayName;
    return typeof displayName === "string" && displayName !== "" ? displayName : id;
}

/** Ключ id расширения для сравнения: регистр не важен. */
export function extensionKey(id: string): string {
    return id.toLowerCase();
}

/**
 * Встроенное расширение VS Code (`vscode.git`, `vscode.typescript-language-features`):
 * у эталона оно часть продукта и есть всегда, поэтому зависимость на него там
 * никогда не «неизвестна». В Diode многих из них нет (`git` у нас — `diode.git`),
 * а поставить их человеку неоткуда — в магазине их нет. Отступление от эталона:
 * такая отсутствующая зависимость не срывает ни активацию, ни установку
 * (стоковый Supermaven зависит от `vscode.git` и без него работает).
 */
export function isBuiltinVSCodeExtension(id: string): boolean {
    return extensionKey(id).startsWith("vscode.");
}

/**
 * Цикл зависимостей, через который проходит `startId`: цепочка id от него
 * самого обратно к нему (`["a", "b", "a"]`), или `null`, если цикла нет.
 * `dependenciesOf` отдаёт зависимости известного расширения и `undefined` —
 * неизвестного (по нему цикл не продолжается: неизвестная зависимость — своя
 * ошибка). Циклы, в которые `startId` не входит, здесь не ищутся: у эталона
 * такие расширения выпадают из реестра целиком, у нас каждое участвующее
 * узнает о цикле на своей активации.
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
