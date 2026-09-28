/**
 * Курируемые config-дефолты host'а для КОНКРЕТНЫХ сторонних расширений — слой
 * поверх дефолтов их манифеста, ниже пользовательских настроек (переопределяемы).
 *
 * basedpyright: манифестный дефолт `importStrategy: "fromEnvironment"` ищет
 * pip-установку сервера через API расширения ms-python.python и падает всей
 * активацией, когда того нет (наш `extensions.getExtension` честно отвечает
 * undefined, а вызов в activate() не обёрнут в try/catch — проверено на 1.40.0).
 * В Diode питон-расширения Microsoft не существует, поэтому единственный рабочий
 * путь — вшитый в vsix сервер; включаем его дефолтом.
 *
 * ruff: манифестный дефолт `importStrategy: "fromEnvironment"` активацию не
 * роняет (без ms-python расширение честно падает на bundled), но сканирует
 * окружение и зависит от PATH; вшитый в платформенный vsix нативный бинарь —
 * детерминированный native server без Python вовсе (`nativeServer: "auto"`
 * выбирает его сам: bundled ruff заведомо ≥ 0.5.3). Пользовательский
 * `settings.json` может вернуть `fromEnvironment` — слой переопределяем.
 *
 * redhat.java: манифестный дефолт `jdt.ls.lombokSupport.enabled: true` на
 * связке jdt.ls 1.57 + JDK 21 ЛОМАЕТ компиляцию — javaagent lombok'а падает
 * внутри JDT (`Lombok can't parse this source: NoSuchFieldError …
 * ConstructorDeclaration.constructorCall`), и вместо диагностик проект целиком
 * получает «Internal compiler error». Это дефект lombok/JDT, а не наш, но
 * пользователю от этого не легче: дефолтная установка Java не работает вовсе.
 * Проверено живьём на maven- и gradle-фикстурах.
 *
 * `updateBuildConfiguration` НЕ трогаем: эталонный `"interactive"` спрашивает
 * после правки pom/gradle «Synchronize now / Never», и с #352 этот вопрос у нас
 * отвечаем — подменять его на `"automatic"` значило бы молча забрать у человека
 * решение, которое ему оставляет VS Code.
 */
export function curatedConfigInjection(extensionId: string): Record<string, unknown> {
    if (extensionId === "detachhead.basedpyright") {
        return { "basedpyright.importStrategy": "useBundled" };
    }
    if (extensionId === "charliermarsh.ruff") {
        return { "ruff.importStrategy": "useBundled" };
    }
    if (extensionId === "redhat.java") {
        return { "java.jdt.ls.lombokSupport.enabled": false };
    }
    return {};
}
