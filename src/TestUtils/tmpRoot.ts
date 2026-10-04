import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Корень временных каталогов на один прогон тестов.
 *
 * Зачем: тесты создают временные каталоги сотнями мест (`fs.mkdtemp` в
 * `os.tmpdir()`), и каждый владелец убирает за собой сам. Это работает, пока
 * прогон доходит до `afterEach`, — но не при SIGKILL, OOM-убийстве воркера или
 * падении по таймауту. На этой машине так накопилось 34 121 каталога `diode-*`
 * на 11 ГБ.
 *
 * Поэтому у прогона есть СВОЙ корень, и `TMPDIR` указывает в него: тестам
 * ничего менять не надо (`os.tmpdir()` читает переменную при каждом вызове),
 * а teardown сносит корень целиком — вместе со всем, что в нём забыли.
 *
 * Корень, оставшийся от аварийно убитого прогона, подбирает следующий: владелец
 * опознаётся по {@link OWNER_FILE}, и корень с мёртвым владельцем сносится.
 * Признак — именно живость процесса, а не возраст: долгий мутационный прогон не
 * должен попасть под уборку соседнего.
 */

// Префикс именно "testrun": "diode-tests-" уже занят `createTestEnvironment`
// (src/vs/diode/modules/testProfile.ts) — его каталоги лежат в том же tmp, и
// подчистка не должна их задевать.
const ROOT_PREFIX = "diode-testrun-";
/** Pid процесса, которому принадлежит корень. */
const OWNER_FILE = "owner.pid";

/** Создаёт корень прогона и помечает его владельцем. */
export function createRunTmpRoot(parent: string, ownerPid: number = process.pid): string {
    const root = fs.mkdtempSync(path.join(parent, ROOT_PREFIX));
    fs.writeFileSync(path.join(root, OWNER_FILE), String(ownerPid), "utf-8");
    return root;
}

/** Жив ли процесс: сигнал `0` ничего не делает, но проверяет существование. */
function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM — процесс есть, но чужой: считаем живым, чужое не сносим.
        return (err as NodeJS.ErrnoException | null)?.code === "EPERM";
    }
}

/**
 * Сносит корни прогонов, чей владелец уже не жив. Возвращает снесённые пути
 * (для лога — молчаливая уборка гигабайтов пугает больше, чем сообщение).
 */
export function pruneStaleRoots(parent: string, isProcessAlive: (pid: number) => boolean = isAlive): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
        return []; // нет родителя — нечего подчищать
    }

    const removed: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(ROOT_PREFIX)) continue;
        const root = path.join(parent, entry.name);
        if (ownerAlive(root, isProcessAlive)) continue;
        try {
            fs.rmSync(root, { recursive: true, force: true });
            removed.push(root);
        } catch {
            // Чужой корень без прав на снос — не наша забота.
        }
    }
    return removed;
}

function ownerAlive(root: string, isProcessAlive: (pid: number) => boolean): boolean {
    let raw: string;
    try {
        raw = fs.readFileSync(path.join(root, OWNER_FILE), "utf-8");
    } catch {
        // Метки нет: либо корень от прогона до этой правки, либо недописан.
        // Владельца не установить — считаем бесхозным.
        return false;
    }
    const pid = Number.parseInt(raw.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    return isProcessAlive(pid);
}

/**
 * `globalSetup` vitest: заводит корень прогона, направляет в него `TMPDIR`
 * (воркеры наследуют окружение) и подчищает корни мёртвых прогонов. Возвращает
 * teardown, сносящий корень целиком.
 */
export function setup(): () => void {
    // Родитель — настоящий системный tmp, а не корень возможного внешнего
    // прогона: вкладывать корни друг в друга не нужно.
    const parent = process.env.DIODE_TEST_TMP_PARENT ?? os.tmpdir();
    const stale = pruneStaleRoots(parent);
    if (stale.length > 0) {
        console.info(`[tmpRoot] подчищено корней от прерванных прогонов: ${stale.length}`);
    }

    const root = createRunTmpRoot(parent);
    process.env.DIODE_TEST_TMP = root;
    process.env.TMPDIR = root;

    return () => {
        fs.rmSync(root, { recursive: true, force: true });
    };
}

export default setup;
