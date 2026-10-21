import { readFileSync } from "node:fs";
import { join } from "node:path";

import iconv from "iconv-lite";
import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * iconv-lite is the lazy chunk `lazy/iconv-lite.cjs`, loaded on the first single-byte
 * encoding. A build without the chunk would fail on the fallback `import("iconv-lite")`, hence
 * the binary is tested; a rejected code cache for the chunk would also show up in Bootstrap.
 */

const GREETING = "\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!"; // "Privet, mir!"
const TEXT = `${GREETING}\n`;
const TYPED = "\u0401\u0436 "; // "Yozh "

async function changeEncoding(session: HeadlessSession, mode: string, encodingLabel: string): Promise<void> {
    await session.sendKey("F1");
    await session.waitForNode("#quickInput");
    await session.sendText("Change File Encoding");
    await session.waitForText((t) => t.includes("Change File Encoding"));
    await session.sendKey("Enter");
    await session.waitForText((t) => t.includes(mode));
    await session.sendText(mode);
    await session.sendKey("Enter");
    await session.waitForText((t) => t.includes("Select File Encoding"));
    await session.sendText(encodingLabel);
    await session.waitForText((t) => t.includes(encodingLabel));
    await session.sendKey("Enter");
}

async function expectBytesOnDisk(file: string, expected: Buffer): Promise<void> {
    await waitUntil(
        () => readFileSync(file),
        (bytes) => bytes.equals(expected),
        { describe: `bytes of ${file}`, diagnose: (last) => (last as Buffer).toString("hex") },
    );
}

async function expectNoBootstrapErrors(session: HeadlessSession): Promise<void> {
    const bootstrap = await session.getOutput("bootstrap");
    expect(bootstrap).not.toContain("unexpected error");
    expect(bootstrap).not.toContain("unhandled rejection");
}

describe("encodings on SEA: iconv is a lazy chunk", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("windows-1251: Reopen with Encoding, edit, byte-exact write", async () => {
        const { session, env } = await useHeadlessApp({
            files: { "cp.txt": iconv.encode(TEXT, "windows1251") },
            open: ["cp.txt"],
        });
        await session.waitForText((t) => t.includes("UTF-8"));

        await changeEncoding(session, "Reopen with Encoding", "Windows 1251");
        await session.waitForText((t) => t.includes(GREETING) && t.includes("Windows 1251"));

        await session.sendText(TYPED);
        await session.waitForText((t) => t.includes(TYPED + GREETING));
        await session.executeCommand("workbench.action.files.save");
        await expectBytesOnDisk(join(env.workspaceDir, "cp.txt"), iconv.encode(`${TYPED}${TEXT}`, "windows1251"));

        await expectNoBootstrapErrors(session);
    }, 120_000);

    it("UTF-16 LE with BOM: open by BOM, edit, write with BOM", async () => {
        const bom = Buffer.from([0xff, 0xfe]);
        const { session, env } = await useHeadlessApp({
            files: { "u16.txt": Buffer.concat([bom, Buffer.from(TEXT, "utf16le")]) },
            open: ["u16.txt"],
        });
        await session.waitForText((t) => t.includes(GREETING) && t.includes("UTF-16 LE"));

        await session.sendText(TYPED);
        await session.waitForText((t) => t.includes(TYPED + GREETING));
        await session.executeCommand("workbench.action.files.save");
        await expectBytesOnDisk(join(env.workspaceDir, "u16.txt"), Buffer.concat([bom, Buffer.from(`${TYPED}${TEXT}`, "utf16le")]));

        await expectNoBootstrapErrors(session);
    }, 120_000);

    it("Save with Encoding to KOI8-R from utf-8", async () => {
        const { session, env } = await useHeadlessApp({ files: { "plain.txt": TEXT }, open: ["plain.txt"] });
        await session.waitForText((t) => t.includes(GREETING) && t.includes("UTF-8"));

        await changeEncoding(session, "Save with Encoding", "KOI8-R");
        await expectBytesOnDisk(join(env.workspaceDir, "plain.txt"), iconv.encode(TEXT, "koi8r"));
        await session.waitForText((t) => t.includes("KOI8-R"));

        await expectNoBootstrapErrors(session);
    }, 120_000);
});
