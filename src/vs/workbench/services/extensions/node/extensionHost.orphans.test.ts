import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";

/** Живёт ли процесс: сигнал `0` ничего не делает, но проверяет существование. */
function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitUntilGone(pid: number, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (isAlive(pid)) {
        if (Date.now() > deadline) throw new Error(`процесс ${pid} всё ещё жив через ${timeoutMs} мс`);
        await new Promise((r) => setTimeout(r, 25));
    }
}

// Языковые серверы — ВНУКИ: сигнал прямому ребёнку их не касается. До группового
// kill'а сироты jdtls переживали редактор и писали гигабайты в globalStorage.
describe("ExtensionHost — потомство расширений не остаётся сиротами", () => {
    it.skipIf(process.platform === "win32")(
        "сервер, поднятый расширением и не закрытый им, уходит вместе с хостом",
        async () => {
            const harness = await createExtensionTestHarness({
                extensions: [extensionFixture("test.orphans", "spawnsLanguageServer.cjs")],
            });
            const serverPid = (await harness.commandRegistry.execute("test.orphans.serverPid")) as number;
            expect(typeof serverPid).toBe("number");
            expect(isAlive(serverPid)).toBe(true);

            await harness.dispose();

            await waitUntilGone(serverPid);
        },
        30_000,
    );
});
