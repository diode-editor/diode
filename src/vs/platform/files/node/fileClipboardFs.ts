import * as fs from "node:fs";
import * as path from "node:path";

/** Как VS Code/Finder: `name` → `name copy` → `name copy 2`, расширение сохраняется. */
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

/** На точный путь, а не «внутрь каталога»; на `EXDEV` — копия и удаление. */
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
