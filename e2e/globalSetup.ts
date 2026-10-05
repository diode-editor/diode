import { setup as setupTmpRoot } from "../src/TestUtils/tmpRoot.ts";

import { buildSelfExtract, getBinaryPath } from "./helpers/buildOnce.ts";

// Собираем бинари один раз до старта воркеров и передаём пути через env —
// иначе при параллельном прогоне форк-воркеры собирали бы свои копии, и tsup
// `clean` одного стирал бы `dist/diode` из-под остальных. Форки наследуют env
// родителя на момент спавна (после globalSetup), поэтому `DIODE_E2E_BINARY` и
// `DIODE_E2E_SELFEXTRACT` доходят до всех; воркер по ним только читает и не
// собирает никогда (см. helpers/buildOnce.ts).
//
// Порядок важен: SEA первой (tsup + бандлы в dist/), self-extract — после неё
// из тех же артефактов (`--reuse-dist`), без второго tsup, чей `clean` снёс бы
// только что собранный `dist/diode`. Self-extract — POSIX sh-стаб, под Windows
// его нет (selfextract.test.ts там пропускается целиком).
//
// Тем же наследованием едет `TMPDIR`: все временные каталоги прогона (user-data
// редактора, фикстурные проекты, каталоги запущенного бинаря) ложатся в один
// корень, который teardown сносит целиком. Без этого прогон, убитый по таймауту
// или OOM, оставлял их в /tmp навсегда — см. src/TestUtils/tmpRoot.ts.
export default async function setup(): Promise<() => void> {
    const teardownTmpRoot = setupTmpRoot();
    process.env.DIODE_E2E_BINARY = await getBinaryPath();
    if (process.platform !== "win32") {
        process.env.DIODE_E2E_SELFEXTRACT = await buildSelfExtract({ reuseDist: true });
    }
    return teardownTmpRoot;
}
