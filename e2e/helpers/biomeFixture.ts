import * as fs from "node:fs";
import * as path from "node:path";

import { writeNpmProject } from "./npmProject.ts";

/** The extension has no binary: the Biome server comes from `node_modules` of the project. */

const BIOME_JSON = `{
    "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 8 },
    "linter": { "enabled": true, "rules": { "recommended": true } },
    "assist": { "enabled": true, "actions": { "source": { "organizeImports": "on" } } }
}
`;

/** Unsorted imports, a `debugger` for the linter, and indentation that Biome rewrites. */
const SAMPLE_JS = `import { z } from "./z.js";
import { b } from "./b.js";
export function f(x) {
  debugger;
  return b + z + x;
}
`;

export const BIOME_SETTINGS = {
    "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
    "editor.codeActionsOnSave": { "source.organizeImports.biome": "explicit" },
};

/** Returns the path of the sample file. */
export function writeBiomeProject(projectRoot: string): string {
    writeNpmProject(projectRoot, "@biomejs/biome");
    fs.writeFileSync(path.join(projectRoot, "biome.json"), BIOME_JSON);
    const file = path.join(projectRoot, "sample.js");
    fs.writeFileSync(file, SAMPLE_JS);
    return file;
}
