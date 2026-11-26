import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { clickText } from "./outputPanel.shared.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-failing-code-lens");

const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/** An absent toast has no event to wait for. */
const SETTLE_MS = 1500;

async function start(): Promise<HeadlessSession> {
    const { session } = await useHeadlessApp({
        seedUserData: userData,
        files: { "main.ts": "const a = 1;\n" },
        open: [".", "main.ts"],
        cols: 120,
        rows: 30,
    });
    await session.waitForText((text) => text.includes("ThrowNothing"), { timeoutMs: 20_000 });
    return session;
}

/** The toast's message without its frame and buttons, on one line; null when there is no toast. */
function toastBody(text: string): string | null {
    const lines = text.split("\n");
    const top = lines.findIndex((line) => line.includes("├─"));
    if (top < 0) return null;
    const left = lines[top].indexOf("├") + 1;
    const body: string[] = [];
    for (const line of lines.slice(top + 1)) {
        if (line.includes("╰─")) break;
        body.push(line.slice(left).replace("│", "").replace("[ × ]", "").trim());
    }
    return body.filter((part) => part !== "").join(" ");
}

async function toastAfterClick(title: string): Promise<string | null> {
    const session = await start();
    await clickText(session, title);
    await session.waitForText((text) => text.includes("╭─"));
    return toastBody(frameToText(await session.captureFrame()));
}

describeLinuxOnly("extension code lens — a failing command in the toast", () => {
    beforeAll(async () => {
        await getBinaryPath();
    });

    it("an unknown command says upstream's message and no stack", { timeout: 60_000 }, async () => {
        const body = await toastAfterClick("Missing");
        expect(body).toContain("command 'failing.nope' not found");
        expect(body).not.toMatch(/\bat \S|\.c?js:\d+|\.ts:\d+/);
    });

    it("a command that throws an Error says its message and no stack", { timeout: 60_000 }, async () => {
        const body = await toastAfterClick("ThrowError");
        expect(body).toContain("command exploded");
        expect(body).not.toMatch(/\bat \S|\.c?js:\d+|\.ts:\d+/);
    });

    it("a command that throws a string says that string", { timeout: 60_000 }, async () => {
        expect(await toastAfterClick("ThrowString")).toContain("plain string failure");
    });

    it("a command that throws nothing leaves no empty toast", { timeout: 60_000 }, async () => {
        const session = await start();
        await clickText(session, "ThrowNothing");
        await new Promise((done) => {
            setTimeout(done, SETTLE_MS);
        });
        const body = toastBody(frameToText(await session.captureFrame()));
        expect(body === null || body.length > 0).toBe(true);
    });
});
