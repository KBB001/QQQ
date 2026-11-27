[![Android CI](https://github.com/KBB001/Sonora/actions/workflows/ci.yml/badge.svg)](https://github.com/KBB001/Sonora/actions/workflows/ci.yml)

# Sonora

Музыкальное стриминг-приложение для Android (аналог YouTube Music / Spotify) на **Kotlin** и **Jetpack Compose** с фоновым воспроизведением, локальной медиатекой, эквалайзером и встроенным автообновлением через GitHub Releases.

## Основные возможности

- **Поиск и стриминг аудио** на базе **NewPipe Extractor** без рекламы.
- **Фоновое воспроизведение и управление со шторки уведомлений** через **Media3 (ExoPlayer + MediaSessionService)**, включая поддержку Android Auto и виджета рабочего стола.
- **Медиатека (Room):** избранные треки, история прослушивания, пользовательские плейлисты и экспорт/импорт резервных копий в JSON.
- **Офлайн-режим и кэширование:** загрузка треков для прослушивания без интернета и управление размером кэша.
- **Настройки звука:** выбор качества аудио, пропуск тишины, автовоспроизведение радио, многополосный эквалайзер и таймер сна.
- **Обновление внутри приложения (OTA):** кнопка **«Обновить приложение»** в разделе *Settings* проверяет последний релиз в GitHub Releases, показывает changelog, скачивает APK с прогресс-баром и запускает системный установщик.

## Технологический стек

- **Язык:** Kotlin
- **UI:** Jetpack Compose, Material Design 3, темная тема
- **Архитектура:** MVVM + Clean Architecture
- **DI:** Hilt
- **Плеер:** AndroidX Media3 (`media3-exoplayer`, `media3-session`)
- **Парсинг потоков:** NewPipe Extractor
- **Локальное хранение:** Room, DataStore Preferences
- **Сеть и изображения:** OkHttp, Coil, Kotlinx Serialization

---

## Локальная сборка

> Требования: **JDK 21** (необходим для Robolectric 4.16+ с Android SDK 36) и **Gradle 9.3.1** (или Android Studio Otter+).

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/<OWNER>/<REPO>.git
   cd <REPO>
   ```
2. Восстановите `debug.keystore` из закодированного шаблона:
   ```bash
   tr -d '[:space:]' < debug.keystore.base64 | base64 --decode > debug.keystore
   ```
   *(На Windows PowerShell:)*
   ```powershell
   [IO.File]::WriteAllBytes("debug.keystore", [Convert]::FromBase64String((Get-Content debug.keystore.base64 -Raw)))
   ```
3. Соберите debug-APK или откройте проект в **Android Studio**:
   ```bash
   gradle :app:assembleDebug
   ```
   Для проверки OTA-обновлений в локальной сборке можно передать репозиторий параметром:
   ```bash
   gradle :app:assembleDebug -PGITHUB_REPOSITORY=<OWNER>/<REPO>
   ```

---

## Автоматическая сборка и релизы (GitHub Actions)

В проекте настроены два workflow в `.github/workflows/`:
- **`ci.yml`** — запускает `:app:testDebugUnitTest` и `:app:assembleDebug` при пуше в `main`/`master` и в Pull Request.
- **`build-release.yml`** — собирает подписанный `release` APK и публикует GitHub Release:
  - автоматически при пуше тега `v*` (например, `v1.0.1`);
  - вручную во вкладке **Actions → Build & Release Android APK → Run workflow**.

### Настройка постоянной подписи релизов (рекомендуется для OTA)

Если секреты не настроены, workflow временно сгенерирует одноразовый keystore для успешной сборки APK. Однако чтобы пользователи могли обновлять приложение поверх уже установленной версии через кнопку **«Обновить приложение»**, используйте постоянный keystore:

1. Создайте ключ подписи с алиасом **`upload`**:
   ```bash
   keytool -genkeypair -v -keystore sonora-release.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Закодируйте его в Base64 одной строкой:
   ```bash
   base64 -w 0 sonora-release.jks
   ```
   *(На macOS: `base64 -i sonora-release.jks | tr -d '\n'`)*
3. Добавьте секреты в **Settings → Secrets and variables → Actions**:
   - `KEYSTORE_BASE64` — содержимое Base64-строки.
   - `KEYSTORE_PASSWORD` — пароль хранилища (store password).
   - `KEY_PASSWORD` — пароль ключа `upload` (key password).

### Публикация нового релиза

```bash
git tag v1.0.1
git push origin v1.0.1
```
После завершения workflow во вкладке **Releases** появится релиз с файлом `sonora-v1.0.1.apk`.

---

## Версия для iPhone (iOS PWA, полностью без серверов)

В каталоге `ios-pwa/` находится автономное веб-приложение **Sonora** для iPhone в нативном стиле iOS (адаптивная светлая/тёмная тема, фоновое аудио при заблокированном экране, управление с экрана блокировки `MediaSession`, мини-плеер и полноэкранный плеер, синхронизированные тексты `LRCLIB`, оффлайн-кэш, импорт медиатеки YouTube Music / Google Takeout и совместимые с Android зашифрованные резервные копии `.sonoraenc`).

Приложение **не требует Cloudflare Worker, Node/Render-сервера или баз данных** — весь поиск, потоки без рекламы (через параллельную федерацию `Piped`, `Invidious` и `Audius`), рекомендации и хранение данных работают прямо на устройстве.

### Включение публикации на GitHub Pages

1. Убедитесь, что репозиторий **публичный (Public)** (на бесплатном тарифе GitHub Pages не поддерживается для приватных репозиториев).
2. Откройте в репозитории **Settings → Pages** и выберите **Build and deployment → Source: GitHub Actions**.
3. Workflow `.github/workflows/deploy-ios-pwa.yml` автоматически протестирует PWA, обновит версию Service Worker и опубликует сайт по HTTPS.

### Установка на iPhone

1. Откройте опубликованный URL вида `https://<OWNER>.github.io/<REPO>/` в **Safari** на iPhone.
2. Нажмите кнопку **«Поделиться»** внизу экрана и выберите **«На экран «Домой»»**.
3. Запускайте **Sonora** с домашнего экрана как обычное приложение — обновления загружаются автоматически при каждом пуше в GitHub.

### Перенос библиотеки из YouTube Music (без серверов)

1. В приложении откройте **Настройки → Импорт YouTube Music** и скопируйте локальный скрипт экспорта или используйте экспорт из **Google Takeout** (`.json` / `.csv`) или резервную копию **Android Sonora** (`.sonoraenc`).
2. Импортируйте полученный файл в Sonora — лайки, история и плейлисты объединятся локально без отправки Cookie или паролей на сторонние серверы.



