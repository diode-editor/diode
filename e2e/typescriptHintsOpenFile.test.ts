import { describe, it } from "vitest";

import { useHeadlessApp } from "./helpers/useApp.ts";
import { clickText } from "./outputPanel.shared.ts";

// The in-process harness cannot show this: its panes get the inlay hint options by hand, each tab has its own pane, and
// that very call asks for the hints. Only the real app reads `editor.inlayHints.enabled` by itself.

const WAIT_MS = 60_000;

const SETTINGS = {
    "typescript.inlayHints.parameterNames.enabled": "all",
    "typescript.inlayHints.variableTypes.enabled": true,
    "typescript.referencesCodeLens.enabled": true,
};

const FILES = {
    "first.ts": "export function hi(title: string) {\n    return title;\n}\nconst first = hi('x');\nexport { first };\n",
    "second.ts": "export function yo(title: string) {\n    return title;\n}\nconst second = yo('y');\nexport { second };\n",
};

describe("Built-in TypeScript — inlay hints in a file opened after the first one", () => {
    it("a second file gets its hints without an edit, like its lens", { timeout: 300_000 }, async () => {
        const { session } = await useHeadlessApp({ files: FILES, settings: SETTINGS, open: [".", "first.ts"] });
        await session.waitForText((t) => t.includes("first : string = hi(title: 'x')"), { timeoutMs: WAIT_MS });

        await clickText(session, "second.ts");
        await session.waitForText((t) => t.includes("function yo"), { timeoutMs: WAIT_MS });
        await session.waitForText((t) => t.includes("1 reference"), { timeoutMs: WAIT_MS });

        await session.waitForText((t) => t.includes("second : string = yo(title: 'y')"), { timeoutMs: WAIT_MS });
    });
});
