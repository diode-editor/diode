import { getBinaryPath } from "./helpers/buildOnce.ts";

// Собираем SEA-бинарь один раз до старта воркеров и передаём путь через env —
// иначе при параллельном прогоне каждый форк-воркер собирал бы свою копию.
// Форки наследуют env родителя на момент спавна (после globalSetup), поэтому
// `DIODE_E2E_BINARY` доходит до всех; getBinaryPath читает его и не собирает.
export default async function setup(): Promise<void> {
    process.env.DIODE_E2E_BINARY = await getBinaryPath();
}
