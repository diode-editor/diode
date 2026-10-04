import { setup as setupTmpRoot } from "../src/TestUtils/tmpRoot.ts";

import { getBinaryPath } from "./helpers/buildOnce.ts";

// Собираем SEA-бинарь один раз до старта воркеров и передаём путь через env —
// иначе при параллельном прогоне каждый форк-воркер собирал бы свою копию.
// Форки наследуют env родителя на момент спавна (после globalSetup), поэтому
// `DIODE_E2E_BINARY` доходит до всех; getBinaryPath читает его и не собирает.
//
// Тем же наследованием едет `TMPDIR`: все временные каталоги прогона (user-data
// редактора, фикстурные проекты, каталоги запущенного бинаря) ложатся в один
// корень, который teardown сносит целиком. Без этого прогон, убитый по таймауту
// или OOM, оставлял их в /tmp навсегда — см. src/TestUtils/tmpRoot.ts.
export default async function setup(): Promise<() => void> {
    const teardownTmpRoot = setupTmpRoot();
    process.env.DIODE_E2E_BINARY = await getBinaryPath();
    return teardownTmpRoot;
}
