import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ITempWorkspaceOptions {
    readonly prefix?: string;
    readonly files?: Readonly<Record<string, string>>;
}

export interface ITempWorkspace {
    readonly dir: string;
    writeFile(relativePath: string, content: string): string;
    path(relativePath: string): string;
    dispose(): void;
}

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
