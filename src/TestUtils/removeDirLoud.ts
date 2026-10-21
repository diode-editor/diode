import * as fs from "node:fs";

/**
 * Not an empty `catch`: that is how garbage piled up in `os.tmpdir()` for years — a live subprocess
 * was still writing to the directory, and nobody knew. Failing would be unfair, hence a warning.
 */
export function removeDirLoud(dir: string, label: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
        console.warn(`[${label}] не удалось снести временный каталог ${dir}:`, err);
    }
}
