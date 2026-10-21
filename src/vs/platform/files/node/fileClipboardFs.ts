import * as fs from "node:fs";
import * as path from "node:path";

/** Like VS Code/Finder: `name` → `name copy` → `name copy 2`, keeping the extension. */
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

/** Moves to the exact path, not "into the directory"; on `EXDEV` copies and deletes. */
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
