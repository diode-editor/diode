import * as fs from "node:fs";

/**
 * Не пустой `catch`: так годами копился мусор в `os.tmpdir()` — в каталог ещё писал
 * живой субпроцесс, и никто не знал. Падать нечестно, поэтому предупреждение.
 */
export function removeDirLoud(dir: string, label: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
        console.warn(`[${label}] не удалось снести временный каталог ${dir}:`, err);
    }
}
