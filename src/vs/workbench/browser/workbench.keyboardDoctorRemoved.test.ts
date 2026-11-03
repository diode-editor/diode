import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

// #1047: Keyboard Doctor was removed — no references may remain in code and docs,
// except the note that a keyboard setup wizard is a future task replacing it (those lines cite #1047).
// A plain `grep -ri "keyboard.\?doctor"` misses a name wrapped across lines and the Russian «доктор».

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const selfPath = path.relative(repoRoot, import.meta.filename);
const mention = /doctor|доктор/i;

function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (/\.(ts|mts|mjs|js|json|md)$/.test(entry.name)) yield full;
    }
}

function leftoverMentions(): string[] {
    const found: string[] = [];
    for (const root of ["src", "e2e", "docs"]) {
        for (const file of walk(path.join(repoRoot, root))) {
            const rel = path.relative(repoRoot, file);
            if (rel === selfPath) continue;
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((line, i) => {
                // Joining with the next line catches "Keyboard\nDoctor".
                const joined = `${line} ${lines[i + 1] ?? ""}`;
                if (!mention.test(line) && !/keyboard\s+doctor/i.test(joined)) return;
                // The future-wizard note cites #1047 and may wrap onto the next line.
                if (line.includes("#1047") || (lines[i - 1] ?? "").includes("#1047")) return;
                found.push(`${rel}:${i + 1}: ${line.trim()}`);
            });
        }
    }
    return found;
}

describe("Keyboard Doctor removal (#1047)", () => {
    it("leaves no mention of the doctor in src, e2e and docs except the future-wizard note", () => {
        expect(leftoverMentions()).toEqual([]);
    });
});
