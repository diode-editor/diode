import { describe, expect, it } from "vitest";

import { sanitizeProcessEnvironment } from "./processes.ts";

describe("sanitizeProcessEnvironment", () => {
    it("removes VS Code/Electron/Snap variables except the preserved and the allowed VSCODE_ ones", () => {
        const env: Record<string, string | undefined> = {
            VSCODE_A: "1",
            VSCODE_B: "2",
            VSCODE_C: "3",
            VSCODE_ENV_APPEND: "4",
            ELECTRON_X: "5",
            SNAP: "6",
            GDK_PIXBUF_Y: "7",
            PATH: "/bin",
        };
        sanitizeProcessEnvironment(env, "VSCODE_A", "VSCODE_C");
        expect(env).toStrictEqual({ VSCODE_A: "1", VSCODE_C: "3", VSCODE_ENV_APPEND: "4", PATH: "/bin" });
    });
});
