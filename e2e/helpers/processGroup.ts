import { describeKilled, reapByEnv } from "../../src/TestUtils/processSweep.ts";

// Уборка процессов e2e, от узкого к широкому:
//  1. `killGroup` — группа редактора (лидер: `detached` у headless, `setsid` в node-pty); языковых
//     серверов в ней нет — у субпроцесса расширений своя группа (`extensionHostProcess.ts`);
//  2. `reapSession` — по метке `DIODE_E2E_SESSION`: всё, что пережило `dispose`, включая внуков;
//  3. teardown корня прогона (`src/TestUtils/tmpRoot.ts`) по `DIODE_TEST_TMP` — остатки убитого воркера.

export const SESSION_MARKER_ENV = "DIODE_E2E_SESSION";

/** Не на posix — одному процессу. Ошибки глотаются: группа могла опустеть, процесс — выйти. */
export function killGroup(child: { readonly pid?: number | undefined; kill(signal: NodeJS.Signals): boolean }, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (pid !== undefined && process.platform !== "win32") {
        try {
            process.kill(-pid, signal);
            return;
        } catch {
            // группы нет (уже пуста) — попробуем сам процесс ниже
        }
    }
    try {
        child.kill(signal);
    } catch {
        // уже вышел
    }
}

/**
 * Добитые — утечка: пишем в stderr, но тест не роняем — его предмет другое, а сирота соседям
 * больше не мешает.
 */
export async function reapSession(sessionTag: string): Promise<void> {
    const killed = await reapByEnv(SESSION_MARKER_ENV, sessionTag);
    if (killed.length > 0) {
        console.error(`[e2e] добиты процессы, пережившие сессию (${String(killed.length)}):\n${describeKilled(killed)}`);
    }
}
