import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { IRawGrammar, Registry } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { createDevAssetAccess } from "../../../../../base/node/assets/createDefaultAssetAccess.ts";
import { getOnigLib } from "../onigLib.ts";

// A fresh Registry per test, a shared `onigLib`: WASM loads once per process.

const here = path.dirname(fileURLToPath(import.meta.url));
const builtinDir = path.resolve(here, "..", "..", "..", "..", "..", "..", "..", "extensions");

const SCOPE_TO_PATH: Partial<Record<string, string>> = {
    "source.js": path.join(builtinDir, "javascript", "syntaxes", "JavaScript.tmLanguage.json"),
    "source.js.jsx": path.join(builtinDir, "javascript", "syntaxes", "JavaScriptReact.tmLanguage.json"),
    "source.ts": path.join(builtinDir, "typescript-basics", "syntaxes", "TypeScript.tmLanguage.json"),
    "source.tsx": path.join(builtinDir, "typescript-basics", "syntaxes", "TypeScriptReact.tmLanguage.json"),
    "source.css": path.join(builtinDir, "css", "syntaxes", "css.tmLanguage.json"),
    "documentation.injection.js.jsx": path.join(
        builtinDir,
        "typescript-basics",
        "syntaxes",
        "jsdoc.js.injection.tmLanguage.json",
    ),
    "documentation.injection.ts": path.join(
        builtinDir,
        "typescript-basics",
        "syntaxes",
        "jsdoc.ts.injection.tmLanguage.json",
    ),
};

const INJECTION_SCOPES_BY_HOST: Record<string, string[]> = {
    "source.js": ["documentation.injection.js.jsx"],
    "source.js.jsx": ["documentation.injection.js.jsx"],
    "source.ts": ["documentation.injection.ts"],
    "source.tsx": ["documentation.injection.ts"],
};

export function createTestRegistry(): Registry {
    return new vsctm.Registry({
        onigLib: getOnigLib(createDevAssetAccess()),
        loadGrammar: async (scopeName: string): Promise<IRawGrammar | null> => {
            const filePath = SCOPE_TO_PATH[scopeName];
            if (filePath === undefined) return null;
            const content = await fs.promises.readFile(filePath, "utf-8");
            return vsctm.parseRawGrammar(content, filePath);
        },
        getInjections: (scopeName: string): string[] | undefined => {
            return INJECTION_SCOPES_BY_HOST[scopeName];
        },
    });
}
