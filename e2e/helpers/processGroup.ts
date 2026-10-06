import { describeKilled, reapByEnv } from "../../src/TestUtils/processSweep.ts";

// Уборка процессов e2e-сессии. Три уровня, от узкого к широкому:
//  1. `killGroup` — сигнал группе редактора (он стартует лидером своей группы:
//     `detached` у headless, `setsid` внутри node-pty у PTY). Ловит прямых
//     помощников редактора, но не субпроцесс расширений с языковыми серверами —
//     у тех своя группа (`extensionHostProcess.ts`).
//  2. `reapSession` — по метке сессии в окружении (`DIODE_E2E_SESSION`): всё, что
//     пережило `dispose`, включая внуков в чужих группах. Зовёт `appSession`.
//  3. teardown корня прогона (`src/TestUtils/tmpRoot.ts`) — по метке прогона
//     `DIODE_TEST_TMP`: то, что осталось от убитого воркера, где до `dispose`
//     дело не дошло вовсе; и при следующем старте — то же для убитого прогона.

/** Метка сессии в окружении спавна. */
export const SESSION_MARKER_ENV = "DIODE_E2E_SESSION";

/**
 * Сигнал всей группе процесса (posix), иначе — одному процессу. Ошибки глотаются:
 * группа могла уже опустеть, процесс — выйти.
 */
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
 * Дать процессам сессии выйти самим и добить оставшихся. Добитые — утечка
 * (редактор или расширение не прибрали за собой), о ней пишем в stderr, но тест
 * не роняем: его предмет — другое, а сирота больше не мешает соседям.
 */
export async function reapSession(sessionTag: string): Promise<void> {
    const killed = await reapByEnv(SESSION_MARKER_ENV, sessionTag);
    if (killed.length > 0) {
        console.error(`[e2e] добиты процессы, пережившие сессию (${String(killed.length)}):\n${describeKilled(killed)}`);
    }
}
