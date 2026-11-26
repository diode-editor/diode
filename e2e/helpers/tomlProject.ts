import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TOML_SCHEMA, TOML_WITH_SCHEMA } from "../../src/TestUtils/tomlFixture.ts";

const BROKEN_TAIL = "\n[dep\n";

/** Backspaces from the end of the file that remove the broken table header. */
export const TOML_BROKEN_TAIL_LENGTH = BROKEN_TAIL.length - 1;

/** A project whose file ends in a broken table header; returns the file. */
export function writeTomlProject(dir: string): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "schema.json"), TOML_SCHEMA);
    const file = join(dir, "sample.toml");
    writeFileSync(file, `${TOML_WITH_SCHEMA}${BROKEN_TAIL}`);
    return file;
}
