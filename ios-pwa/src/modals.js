import { escapeHtml } from './security.js';

export const YOUTUBE_COOKIE_SNIPPET = `(() => {
  const c = document.cookie || '';
  if (!c.includes('SAPISID') && !c.includes('__Secure-3PAPISID')) {
    alert('Откройте music.youtube.com под своим аккаунтом и повторите запуск.');
    return;
  }
  navigator.clipboard?.writeText(c).then(
    () => alert('Cookie скопированы! Вставьте их в Sonora.'),
    () => prompt('Скопируйте Cookie вручную:', c)
  );
})();`;

export function buildCreatePlaylistModalHtml() {
  return `
    <h3 class="modal-title">Новый плейлист</h3>
    <form id="create-playlist-form">
      <input id="new-playlist-name" class="ios-field" type="text" placeholder="Название плейлиста" required />
      <input id="new-playlist-desc" class="ios-field" type="text" placeholder="Описание (необязательно)" />
      <button type="submit" class="btn-primary-full">Создать</button>
      <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
    </form>
  `;
}

export function buildImportPlaylistModalHtml() {
  return `
    <h3 class="modal-title">Импорт плейлиста YouTube Music</h3>
    <p class="modal-desc">Вставьте ссылку или ID плейлиста (PL... или OLAK5uy_...)</p>
    <form id="import-yt-playlist-form">
      <input id="yt-playlist-url" class="ios-field" type="url" placeholder="https://music.youtube.com/playlist?list=..." required />
      <button type="submit" class="btn-primary-full">Импортировать</button>
      <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
    </form>
  `;
}

export function buildRenamePlaylistModalHtml(playlist) {
  return `
    <h3 class="modal-title">Изменить плейлист</h3>
    <form id="rename-playlist-form" data-playlist-id="${playlist.id}">
      <input id="rename-playlist-name" class="ios-field" type="text" value="${escapeHtml(playlist.name)}" required />
      <input id="rename-playlist-desc" class="ios-field" type="text" placeholder="Описание" value="${escapeHtml(playlist.description || '')}" />
      <button type="submit" class="btn-primary-full">Сохранить</button>
      <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
    </form>
  `;
}

export function buildDeletePlaylistModalHtml(playlist) {
  return `
    <h3 class="modal-title">Удалить плейлист «${escapeHtml(playlist.name)}»?</h3>
    <p class="modal-desc">Это действие удалит список треков из локальной медиатеки.</p>
    <button type="button" class="btn-danger-full" data-action="delete-playlist" data-playlist-id="${playlist.id}">Удалить</button>
    <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
  `;
}

export function buildTrackMenuHtml(track, { isFav, isOffline, isDownloading, canRemoveFromPl }) {
  const safeId = escapeHtml(track.id);
  return `
    <h3 class="modal-title">${escapeHtml(track.title)}</h3>
    <p class="modal-sub-title">${escapeHtml(track.artist)}</p>
    <button type="button" class="btn-secondary-full" data-action="toggle-favorite" data-track-id="${safeId}">
      ${isFav ? 'Убрать из Избранного' : 'Добавить в Избранное'}
    </button>
    <button type="button" class="btn-secondary-full" data-action="toggle-offline-track" data-track-id="${safeId}">
      ${isDownloading ? 'Загружается оффлайн…' : isOffline ? 'Удалить из оффлайн-кэша' : 'Скачать оффлайн (без интернета)'}
    </button>
    <button type="button" class="btn-secondary-full" data-action="menu-play-next" data-track-id="${safeId}">Играть следующим</button>
    <button type="button" class="btn-secondary-full" data-action="menu-add-queue" data-track-id="${safeId}">Добавить в очередь</button>
    <button type="button" class="btn-secondary-full" data-action="menu-start-radio" data-track-id="${safeId}">Запустить радио по треку</button>
    <button type="button" class="btn-secondary-full" data-action="menu-add-playlist" data-track-id="${safeId}">Добавить в плейлист</button>
    ${
      canRemoveFromPl
        ? `<button type="button" class="btn-danger-full" data-action="remove-from-active-playlist" data-track-id="${safeId}">Удалить из плейлиста</button>`
        : ''
    }
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildAddToPlaylistModalHtml(track, playlists) {
  const safeId = escapeHtml(track.id);
  return `
    <h3 class="modal-title">Выберите плейлист</h3>
    ${
      playlists.length > 0
        ? playlists
            .map(
              (pl) =>
                `<button type="button" class="btn-secondary-full" data-action="add-to-specific-playlist" data-playlist-id="${pl.id}" data-track-id="${safeId}">${escapeHtml(pl.name)} (${pl.tracks.length})</button>`
            )
            .join('')
        : '<p class="modal-desc">У вас пока нет плейлистов.</p>'
    }
    <button type="button" class="btn-primary-full" data-action="open-create-playlist">Создать новый плейлист</button>
    <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
  `;
}

export function buildAddTracksPickerModalHtml({
  playlistId,
  tab,
  query,
  results,
  loading,
  playlistTrackIds,
  favorites,
  history,
  registerTrack,
  getSafeThumb
}) {
  const list = tab === 'search' ? results : tab === 'favorites' ? favorites : history;
  const rowsHtml =
    loading
      ? `<p class="modal-desc">Ищем треки в каталоге…</p>`
      : list.length > 0
        ? `<div class="grouped-card picker-list-wrap">
            ${list
              .slice(0, 30)
              .map((t) => {
                registerTrack(t);
                const already = playlistTrackIds.has(t.id);
                return `
                  <button type="button" class="track-row" data-action="pick-track-for-playlist" data-playlist-id="${playlistId}" data-track-id="${escapeHtml(t.id)}">
                    <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" loading="lazy" />
                    <div class="track-meta">
                      <div class="track-title">${escapeHtml(t.title)}</div>
                      <div class="track-sub">${escapeHtml(t.artist)}</div>
                    </div>
                    <span class="picker-badge ${already ? 'added' : ''}">${already ? '✓' : '+'}</span>
                  </button>`;
              })
              .join('')}
          </div>`
        : `<p class="modal-desc">${
            tab === 'search'
              ? 'Введите название трека или артиста выше.'
              : 'Список пуст. Переключитесь на «Поиск» или послушайте музыку.'
          }</p>`;

  return `
    <h3 class="modal-title">Добавить треки</h3>
    <div class="segmented-control cols-3">
      <button type="button" class="seg-btn ${tab === 'search' ? 'active' : ''}" data-action="picker-set-tab" data-picker-tab="search" data-playlist-id="${playlistId}">Поиск</button>
      <button type="button" class="seg-btn ${tab === 'favorites' ? 'active' : ''}" data-action="picker-set-tab" data-picker-tab="favorites" data-playlist-id="${playlistId}">Избранное</button>
      <button type="button" class="seg-btn ${tab === 'history' ? 'active' : ''}" data-action="picker-set-tab" data-picker-tab="history" data-playlist-id="${playlistId}">История</button>
    </div>
    ${
      tab === 'search'
        ? `<form id="picker-search-form" data-playlist-id="${playlistId}" class="search-bar-wrap">
             <div class="search-input-box">
               <input id="picker-search-input" class="search-input" type="search" placeholder="Найти трек в каталоге…" value="${escapeHtml(query)}" />
             </div>
             <button type="submit" class="btn-accent-sm">Найти</button>
           </form>`
        : ''
    }
    ${rowsHtml}
    <button type="button" class="btn-secondary-full" data-action="close-modal">Готово</button>
  `;
}

export function buildSleepTimerModalHtml() {
  return `
    <h3 class="modal-title">Таймер сна</h3>
    ${[15, 30, 45, 60, 90]
      .map(
        (m) =>
          `<button type="button" class="btn-secondary-full" data-action="set-sleep" data-minutes="${m}">${m} минут</button>`
      )
      .join('')}
    <button type="button" class="btn-danger-full" data-action="set-sleep" data-minutes="0">Выключить таймер</button>
    <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
  `;
}

export function buildQueueModalHtml({ queue, currentIndex, getSafeThumb }) {
  return `
    <h3 class="modal-title">Очередь (${queue.length})</h3>
    ${
      queue.length > 0
        ? `<div class="grouped-card">
            ${queue
              .map(
                (t, i) => `
              <button type="button" class="track-row ${i === currentIndex ? 'active-track' : ''}" data-action="jump-queue" data-qindex="${i}">
                <span class="track-index-num">${i + 1}</span>
                <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" loading="lazy" />
                <div class="track-meta">
                  <div class="track-title">${escapeHtml(t.title)}</div>
                  <div class="track-sub">${escapeHtml(t.artist)}</div>
                </div>
              </button>`
              )
              .join('')}
          </div>`
        : '<p class="modal-desc">Очередь воспроизведения пуста.</p>'
    }
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildRemotePlaylistModalHtml(remote, item, tracks, getSafeThumb) {
  const previewRows = tracks
    .slice(0, 10)
    .map(
      (t, i) => `
      <div class="track-row">
        <span class="track-index-num">${i + 1}</span>
        <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" loading="lazy" />
        <div class="track-meta">
          <div class="track-title">${escapeHtml(t.title)}</div>
          <div class="track-sub">${escapeHtml(t.artist)}</div>
        </div>
      </div>`
    )
    .join('');

  return `
    <h3 class="modal-title">${escapeHtml(remote.title || item.title)}</h3>
    <p class="modal-sub-title">${tracks.length} треков • ${escapeHtml(remote.author || item.artist || 'YouTube Music')}</p>
    <button type="button" class="btn-primary-full" id="remote-pl-play">Включить всё</button>
    <button type="button" class="btn-secondary-full" id="remote-pl-queue">Добавить в очередь</button>
    <button type="button" class="btn-secondary-full" id="remote-pl-save">Сохранить в Медиатеку</button>
    ${previewRows ? `<div class="grouped-card modal-preview-list">${previewRows}</div>` : ''}
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildYouTubeAccountModalHtml({
  serverUrl,
  hasToken,
  authStatus,
  activeAccount,
  accounts,
  statusMessage
}) {
  const acc = activeAccount || {};
  const needsClaim = authStatus?.needsClaim === true;
  const requiresLogin = serverUrl && !hasToken;

  let serverAuthBlock = '';
  if (serverUrl) {
    if (hasToken) {
      serverAuthBlock = `<div class="status-pill ok">Сессия Node/Render активна</div>`;
    } else if (needsClaim) {
      serverAuthBlock = `
        <div class="helper-box">
          <div class="helper-title">Первичная настройка кода доступа сервера</div>
          <p class="modal-desc">Придумайте личный код доступа (от 6 символов), чтобы защитить ваш Render-сервер.</p>
          <div class="inline-auth-row">
            <input id="server-passcode-input" class="ios-field" type="password" minlength="6" placeholder="Новый код доступа (мин. 6)" />
            <button type="button" class="btn-accent-sm" data-action="server-claim-passcode">Задать</button>
          </div>
        </div>`;
    } else if (requiresLogin) {
      serverAuthBlock = `
        <div class="helper-box">
          <div class="helper-title">Вход на Node/Render сервер</div>
          <p class="modal-desc">Введите код доступа сервера (токен хранится только в оперативной памяти вкладки).</p>
          <div class="inline-auth-row">
            <input id="server-passcode-input" class="ios-field" type="password" placeholder="Код доступа сервера" />
            <button type="button" class="btn-accent-sm" data-action="server-login-passcode">Войти</button>
          </div>
        </div>`;
    }
  }

  return `
    <h3 class="modal-title">Аккаунт YouTube Music</h3>
    <p class="modal-desc">
      Подключите ваш сервер Node/Render для входа по сессии YouTube Music, синхронизации лайков, истории и плейлистов, а также прямых потоков без рекламы.
    </p>
    ${
      accounts.length > 0
        ? `<div class="account-pills-row">
            ${accounts
              .map(
                (a) => `
              <button type="button" class="chip-btn ${a.id === acc.id ? 'active' : ''}" data-action="switch-yt-account" data-account-id="${escapeHtml(a.id)}">
                ${escapeHtml(a.name)}
              </button>`
              )
              .join('')}
          </div>`
        : ''
    }
    <div class="inline-auth-row">
      <input id="yt-server-url" class="ios-field" type="url" placeholder="https://sonora-server.onrender.com" value="${escapeHtml(serverUrl || acc.proxyUrl || '')}" />
      <button type="button" class="btn-accent-sm" data-action="check-server-status">Проверить</button>
    </div>
    ${statusMessage ? `<div class="modal-status-msg">${escapeHtml(statusMessage)}</div>` : ''}
    ${serverAuthBlock}
    <div class="helper-box">
      <div class="helper-title">Как получить Cookie YouTube Music</div>
      <p class="modal-desc">Откройте <b>music.youtube.com</b> в браузере, войдите в Google-аккаунт и скопируйте Cookie (или экспортируйте <code>cookies.txt</code>).</p>
      <button type="button" class="btn-secondary-full" data-action="copy-cookie-snippet">Скопировать скрипт для получения Cookie</button>
    </div>
    <form id="yt-account-form">
      <textarea id="yt-cookie-header" class="ios-field ios-textarea" placeholder="Вставьте строку Cookie или содержимое cookies.txt (шифруется локально AES-GCM)" required>${escapeHtml(acc.cookieHeader || '')}</textarea>
      <div class="inline-auth-row">
        <input id="yt-authuser-idx" class="ios-field" type="number" min="0" max="9" placeholder="AuthUser (0)" value="${Number(acc.authUserIndex) || 0}" />
        <input id="yt-datasync-id" class="ios-field" type="text" placeholder="dataSyncId (необяз.)" value="${escapeHtml(acc.dataSyncId || '')}" />
      </div>
      <button type="submit" class="btn-primary-full">Подключить и синхронизировать</button>
      ${acc.id ? `<button type="button" class="btn-danger-full" data-action="remove-current-account" data-account-id="${escapeHtml(acc.id)}">Удалить этот аккаунт</button>` : ''}
      <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
    </form>
  `;
}

export function buildRoutingModalHtml({
  workerCatalogUrl,
  serverUrl,
  customApiBaseUrl,
  activeSourceLabel,
  diagnosticsHtml
}) {
  return `
    <h3 class="modal-title">Маршрутизация каталога и прокси</h3>
    <p class="modal-desc">
      Приоритет загрузки: <b>1. Личный Cloudflare Worker</b> → <b>2. Node/Render сервер</b> → <b>3. Piped / Invidious / Audius</b>.
      Сейчас активен: <b>${escapeHtml(activeSourceLabel)}</b>.
    </p>
    <button type="button" class="btn-secondary-full" data-action="copy-worker-script">Скопировать код Cloudflare Worker</button>
    <form id="routing-config-form" class="routing-form">
      <label class="field-label" for="worker-catalog-url">Личный Cloudflare Worker (HTTPS)</label>
      <input id="worker-catalog-url" class="ios-field" type="url" placeholder="https://sonora-worker.yourname.workers.dev" value="${escapeHtml(workerCatalogUrl)}" />
      <label class="field-label" for="routing-server-url">Node/Render сервер (HTTPS)</label>
      <input id="routing-server-url" class="ios-field" type="url" placeholder="https://sonora-server.onrender.com" value="${escapeHtml(serverUrl)}" />
      <label class="field-label" for="custom-api-url">Запасной Piped API (HTTPS, необязательно)</label>
      <input id="custom-api-url" class="ios-field" type="url" placeholder="https://pipedapi.example.com" value="${escapeHtml(customApiBaseUrl)}" />
      <button type="button" class="btn-secondary-full" data-action="test-routing-endpoints">Проверить связь (Worker и Сервер)</button>
      ${diagnosticsHtml ? `<div class="helper-box">${diagnosticsHtml}</div>` : ''}
      <button type="submit" class="btn-primary-full">Сохранить маршрутизацию</button>
      <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
    </form>
  `;
}

export function buildEncryptExportModalHtml() {
  return `
    <h3 class="modal-title">Пароль шифрования (.sonoraenc)</h3>
    <p class="modal-desc">Этот же пароль подойдёт для восстановления копии в Android-приложении Sonora.</p>
    <form id="encrypt-export-form">
      <input id="export-password" class="ios-field" type="password" minlength="6" placeholder="Минимум 6 символов" required />
      <button type="submit" class="btn-primary-full">Зашифровать и скачать</button>
      <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
    </form>
  `;
}

export function buildDecryptImportModalHtml() {
  return `
    <h3 class="modal-title">Расшифровка резервной копии</h3>
    <p class="modal-desc">Введите пароль, использованный при экспорте файла .sonoraenc.</p>
    <form id="decrypt-import-form">
      <input id="import-password" class="ios-field" type="password" placeholder="Пароль" required />
      <button type="submit" class="btn-primary-full">Расшифровать и восстановить</button>
      <button type="button" class="btn-secondary-full" data-action="close-modal">Отмена</button>
    </form>
  `;
}
