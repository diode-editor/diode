import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ITempWorkspaceOptions {
    /** Префикс имени каталога в `os.tmpdir()` — чтобы остатки от упавших тестов были опознаваемы. */
    readonly prefix?: string;
    /** Сид-файлы: относительный путь → содержимое. Родительские каталоги создаются автоматически. */
    readonly files?: Readonly<Record<string, string>>;
}

export interface ITempWorkspace {
    readonly dir: string;
    /** Пишет файл (создавая родительские каталоги), возвращает его абсолютный путь. */
    writeFile(relativePath: string, content: string): string;
    /** Абсолютный путь записи внутри воркспейса (без обращения к файловой системе). */
    path(relativePath: string): string;
    /** `rmSync(dir, { recursive, force })` — безопасно звать в afterEach/finally. */
    dispose(): void;
}

/**
 * Временный воркспейс для тестов: `mkdtempSync` + сид-файлы + рекурсивный
 * teardown. Композиция с {@link createAppTestHarness}: воркспейс и харнесс
 * владеют своими ресурсами по отдельности.
 *
 *     const ws = createTempWorkspace({ files: { "alpha.txt": "Alpha" } });
 *     // ... afterEach: ws.dispose();
 */
export function createTempWorkspace(options: ITempWorkspaceOptions = {}): ITempWorkspace {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? "diode-test-"));

    const resolve = (relativePath: string): string => path.join(dir, relativePath);

    const writeFile = (relativePath: string, content: string): string => {
        const filePath = resolve(relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        return filePath;
    };

    for (const [relativePath, content] of Object.entries(options.files ?? {})) {
        writeFile(relativePath, content);
    }

    return {
        dir,
        writeFile,
        path: resolve,
        dispose: () => {
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}
