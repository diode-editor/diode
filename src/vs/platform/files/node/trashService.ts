import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ITrashEntry, ITrashService } from "../common/iTrashService.ts";

import { moveToPath, resolveNonConflictingDest } from "./fileClipboardFs.ts";

/**
 * Системная корзина по спецификации freedesktop.org (Linux): перенос в
 * `$XDG_DATA_HOME/Trash/files` + запись `Trash/info/<имя>.trashinfo`. Реализуем спеку
 * сами (а не shell к `gio`), чтобы полностью контролировать восстановление и не зависеть
 * от внешних утилит. На платформах без поддерживаемого бэкенда корзина считается
 * недоступной — вызывающий код тогда удаляет безвозвратно.
 */
export class TrashService implements ITrashService {
    private trashHome(): string {
        // Пустой XDG_DATA_HOME по спеке трактуем как незаданный (отсюда явная проверка, а не `??`).
        let dataHome = process.env.XDG_DATA_HOME;
        if (dataHome === undefined || dataHome === "") {
            dataHome = path.join(os.homedir(), ".local", "share");
        }
        return path.join(dataHome, "Trash");
    }

    /** Опрос системы: есть ли пригодная корзина (и можно ли в неё писать). */
    public isAvailable(): boolean {
        if (process.platform !== "linux") return false;
        return this.ensureDirs();
    }

    private ensureDirs(): boolean {
        try {
            fs.mkdirSync(path.join(this.trashHome(), "files"), { recursive: true });
            fs.mkdirSync(path.join(this.trashHome(), "info"), { recursive: true });
            return true;
        } catch {
            return false;
        }
    }

    public trash(filePath: string): Promise<ITrashEntry> {
        return Promise.resolve().then(() => this.trashSync(filePath));
    }

    private trashSync(filePath: string): ITrashEntry {
        if (!this.ensureDirs()) {
            throw new Error("Системная корзина недоступна");
        }
        const home = this.trashHome();
        const filesDir = path.join(home, "files");
        const originalPath = path.resolve(filePath);

        const trashedPath = resolveNonConflictingDest(filesDir, path.basename(originalPath));
        const trashedName = path.basename(trashedPath);
        const infoPath = path.join(home, "info", `${trashedName}.trashinfo`);

        // Сначала .trashinfo (по спеке — атомарно «застолбить» имя), затем перенос файла.
        fs.writeFileSync(infoPath, this.formatInfo(originalPath), { flag: "wx" });
        moveToPath(originalPath, trashedPath);

        return { originalPath, trashedPath, infoPath };
    }

    public restore(entry: ITrashEntry): Promise<string> {
        return Promise.resolve().then(() => this.restoreSync(entry));
    }

    private restoreSync(entry: ITrashEntry): string {
        let dest = entry.originalPath;
        if (fs.existsSync(dest)) {
            dest = resolveNonConflictingDest(path.dirname(dest), path.basename(dest));
        }
        moveToPath(entry.trashedPath, dest);
        fs.rmSync(entry.infoPath, { force: true });
        return dest;
    }

    private formatInfo(originalPath: string): string {
        const encodedPath = originalPath.split("/").map(encodeURIComponent).join("/");
        return `[Trash Info]\nPath=${encodedPath}\nDeletionDate=${formatDeletionDate(new Date())}\n`;
    }
}

/** Локальное время в формате `YYYY-MM-DDThh:mm:ss` (freedesktop DeletionDate). */
function formatDeletionDate(date: Date): string {
    const p = (n: number): string => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
        `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
    );
}
