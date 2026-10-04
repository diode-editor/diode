import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Синхронные ФС-операции корзины (`TrashService`): подбор свободного имени и
 * перенос на точный путь. Вставка проводника ходит через `IFileService`
 * (`WorkspaceEditService`), здесь её больше нет.
 */

/**
 * Подбирает имя в `targetDir`, не конфликтующее с существующими записями.
 * Повторяет поведение VS Code/Finder: `name` → `name copy` → `name copy 2` → …,
 * сохраняя расширение для файлов. Возвращает полный путь назначения.
 */
export function resolveNonConflictingDest(targetDir: string, name: string): string {
    const direct = path.join(targetDir, name);
    if (!fs.existsSync(direct)) return direct;

    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;

    for (let i = 1; ; i++) {
        const suffix = i === 1 ? " copy" : ` copy ${i}`;
        const candidate = path.join(targetDir, `${base}${suffix}${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
}

/**
 * Перемещает `src` на точный путь `dest` (а не «внутрь каталога»). На cross-device
 * (`EXDEV`) — копирует и удаляет. Используется обратимыми операциями (корзина, откат move),
 * где назначение известно поимённо.
 */
export function moveToPath(src: string, dest: string): void {
    try {
        fs.renameSync(src, dest);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EXDEV") {
            fs.cpSync(src, dest, { recursive: true });
            fs.rmSync(src, { recursive: true, force: true });
        } else {
            throw error;
        }
    }
}
