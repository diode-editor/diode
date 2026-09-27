#!/usr/bin/env node
// postinstall: предзагрузка бинаря. Ошибка сети здесь не валит `npm install` —
// бинарь докачается при первом запуске (bin/diode.js). Так пакет ставится и в
// офлайн-сборках/с `--ignore-scripts`, а падает только там, где его реально запускают.
import { download, isInstalled } from "./lib/binary.js";

if (!isInstalled()) {
    try {
        await download();
    } catch (error) {
        console.error(`diode: postinstall download skipped (${error.message}); will retry on first run`);
    }
}
