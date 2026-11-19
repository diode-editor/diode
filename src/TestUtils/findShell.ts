import { existsSync } from "node:fs";
import * as path from "node:path";

/** The shell on `PATH`, as CI checks it (`command -v`); the shell suites are skipped without it. */
export function findShell(name: string): string | undefined {
    return String(process.env.PATH)
        .split(path.delimiter)
        .map((dir) => path.join(dir, name))
        .find((p) => existsSync(p));
}
