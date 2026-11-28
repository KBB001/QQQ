import { VERSION_LABELS_RU } from './recommendations.js';
import { escapeHtml } from './security.js';

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
    <h3 class="modal-title">Импорт по ссылкам YouTube Music</h3>
    <p class="modal-desc">Вставьте одну или сразу несколько ссылок/ID (по одной на строке) на плейлисты или треки YouTube / YouTube Music.</p>
    <form id="import-yt-playlist-form">
      <textarea id="yt-playlist-url" class="ios-field ios-textarea" placeholder="https://music.youtube.com/playlist?list=PL...\nhttps://music.youtube.com/watch?v=..." required></textarea>
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

export function buildTrackMenuHtml(track, { isFav, isOffline, isDownloading, progressPct = 0, canRemoveFromPl }) {
  const safeId = escapeHtml(track.id);
  const dlText = isDownloading
    ? `Отменить загрузку (${progressPct > 0 ? `${progressPct}%` : 'подготовка…'})`
    : isOffline
      ? 'Удалить из оффлайн-кэша'
      : 'Скачать оффлайн (без интернета)';
  return `
    <h3 class="modal-title">${escapeHtml(track.title)}</h3>
    <p class="modal-sub-title">${escapeHtml(track.artist)}</p>
    <button type="button" class="btn-secondary-full" data-action="toggle-favorite" data-track-id="${safeId}">
      ${isFav ? 'Убрать из Избранного' : 'Добавить в Избранное'}
    </button>
    <button type="button" class="btn-secondary-full" data-action="${isDownloading ? 'cancel-offline-track' : 'toggle-offline-track'}" data-track-id="${safeId}">
      ${dlText}
    </button>
    <button type="button" class="btn-secondary-full" data-action="menu-play-next" data-track-id="${safeId}">Играть следующим</button>
    <button type="button" class="btn-secondary-full" data-action="menu-add-queue" data-track-id="${safeId}">Добавить в очередь</button>
    <button type="button" class="btn-secondary-full" data-action="menu-start-radio" data-track-id="${safeId}">Запустить радио по треку</button>
    <button type="button" class="btn-secondary-full" data-action="menu-open-versions" data-track-id="${safeId}">Версии и ремиксы</button>
    <button type="button" class="btn-secondary-full" data-action="menu-open-artist" data-track-id="${safeId}">Перейти к артисту</button>
    <button type="button" class="btn-secondary-full" data-action="menu-add-playlist" data-track-id="${safeId}">Добавить в плейлист</button>
    ${
      isOffline
        ? `<button type="button" class="btn-secondary-full" data-action="export-offline-file" data-track-id="${safeId}">Сохранить аудиофайл на устройство</button>`
        : ''
    }
    <button type="button" class="btn-secondary-full" data-action="share-track" data-track-id="${safeId}">Поделиться треком</button>
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
    <div class="modal-header-row">
      <h3 class="modal-title">Очередь (${queue.length})</h3>
      ${
        queue.length > 0
          ? `<button type="button" class="section-action danger-text" data-action="clear-queue">Очистить</button>`
          : ''
      }
    </div>
    ${
      queue.length > 0
        ? `<div class="grouped-card">
            ${queue
              .map(
                (t, i) => `
              <div class="track-row ${i === currentIndex ? 'active-track' : ''}">
                <span class="track-index-num">${i === currentIndex ? '▶' : i + 1}</span>
                <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" loading="lazy" />
                <button type="button" class="track-meta" data-action="jump-queue" data-qindex="${i}">
                  <div class="track-title">${escapeHtml(t.title)}</div>
                  <div class="track-sub">${escapeHtml(t.artist)}</div>
                </button>
                ${
                  i > 0
                    ? `<button type="button" class="track-more-btn queue-act-btn" data-action="queue-move-up" data-qindex="${i}" title="Выше" aria-label="Выше">↑</button>`
                    : ''
                }
                ${
                  i + 1 < queue.length
                    ? `<button type="button" class="track-more-btn queue-act-btn" data-action="queue-move-down" data-qindex="${i}" title="Ниже" aria-label="Ниже">↓</button>`
                    : ''
                }
                <button type="button" class="track-more-btn queue-act-btn" data-action="queue-remove" data-qindex="${i}" title="Удалить из очереди" aria-label="Удалить из очереди">✕</button>
              </div>`
              )
              .join('')}
          </div>`
        : '<p class="modal-desc">Очередь воспроизведения пуста.</p>'
    }
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildRemotePlaylistModalHtml(remote, item, tracks, getSafeThumb) {
  const previewLimit = 25;
  const previewRows = tracks
    .slice(0, previewLimit)
    .map(
      (t, i) => `
      <button type="button" class="track-row" data-action="play-remote-track" data-remote-idx="${i}">
        <span class="track-index-num">${i + 1}</span>
        <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" loading="lazy" />
        <div class="track-meta">
          <div class="track-title">${escapeHtml(t.title)}</div>
          <div class="track-sub">${escapeHtml(t.artist)}</div>
        </div>
      </button>`
    )
    .join('');

  return `
    <h3 class="modal-title">${escapeHtml(remote.title || item.title)}</h3>
    <p class="modal-sub-title">${tracks.length} треков • ${escapeHtml(remote.author || item.artist || 'YouTube Music')}</p>
    <button type="button" class="btn-primary-full" id="remote-pl-play">Включить всё</button>
    <button type="button" class="btn-secondary-full" id="remote-pl-queue">Добавить в очередь</button>
    <button type="button" class="btn-secondary-full" id="remote-pl-save">Сохранить в Медиатеку</button>
    <button type="button" class="btn-secondary-full" id="remote-pl-offline">Скачать оффлайн</button>
    ${
      previewRows
        ? `<div class="grouped-card modal-preview-list">${previewRows}</div>
           ${tracks.length > previewLimit ? `<p class="modal-desc mt-8">Показаны первые ${previewLimit} из ${tracks.length} треков.</p>` : ''}`
        : ''
    }
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildMixPreviewModalHtml(mix, getSafeThumb) {
  const tracks = Array.isArray(mix?.tracks) ? mix.tracks : [];
  const rows = tracks
    .map(
      (t, i) => `
      <button type="button" class="track-row" data-action="play-mix-track" data-mix-id="${escapeHtml(mix.id)}" data-mix-idx="${i}">
        <span class="track-index-num">${i + 1}</span>
        <img src="${escapeHtml(getSafeThumb(t))}" alt="" class="track-thumb" loading="lazy" />
        <div class="track-meta">
          <div class="track-title">${escapeHtml(t.title)}</div>
          <div class="track-sub">${escapeHtml(t.artist)}</div>
        </div>
      </button>`
    )
    .join('');

  return `
    <h3 class="modal-title">${escapeHtml(mix.title || 'Персональный микс')}</h3>
    <p class="modal-sub-title">${escapeHtml(mix.subtitle || `${tracks.length} треков`)}</p>
    <button type="button" class="btn-primary-full" id="mix-modal-play">Слушать всё</button>
    <div class="action-pills-row">
      <button type="button" class="btn-secondary-full" id="mix-modal-shuffle">Перемешать</button>
      <button type="button" class="btn-secondary-full" id="mix-modal-queue">В очередь</button>
      <button type="button" class="btn-secondary-full" id="mix-modal-save">Сохранить в Медиатеку</button>
    </div>
    ${rows ? `<div class="grouped-card modal-preview-list">${rows}</div>` : ''}
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildAccountAuthModalHtml({
  activeAccount,
  accounts = [],
  tab = 'youtube',
  showAddForm = false,
  loading = false,
  statusMessage = ''
} = {}) {
  const hasAccount = Boolean(activeAccount?.id);
  const acc = activeAccount || {};
  const activeTab = tab === 'profile' ? 'profile' : 'youtube';
  const initials = (acc.name || 'S').trim().charAt(0).toUpperCase() || 'S';
  const canSyncYouTube = acc.authType === 'youtube_channel' || acc.authType === 'google_oauth';
  const typeBadge =
    acc.authType === 'youtube_channel'
      ? 'YouTube канал'
      : acc.authType === 'google_oauth'
        ? 'Google аккаунт'
        : 'Профиль Sonora';
  const metaSub = acc.handle || acc.email || typeBadge;

  const profileCardHtml = hasAccount
    ? `<div class="account-profile-card">
         ${
           acc.avatarUrl
             ? `<img src="${escapeHtml(acc.avatarUrl)}" alt="" class="account-avatar-lg" />`
             : `<div class="account-avatar-lg account-avatar-fallback">${escapeHtml(initials)}</div>`
         }
         <div class="account-profile-meta">
           <div class="account-profile-name">${escapeHtml(acc.name)}</div>
           <div class="account-profile-sub">${escapeHtml(metaSub)}</div>
           <span class="status-pill ok">${escapeHtml(typeBadge)}</span>
         </div>
       </div>
       ${
         accounts.length > 1
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
       ${
         canSyncYouTube
           ? `<button type="button" class="btn-primary-full" data-action="sync-active-account" ${loading ? 'disabled' : ''}>
                ${loading ? 'Обновляем…' : 'Обновить плейлисты из YouTube'}
              </button>`
           : ''
       }
       <button type="button" class="btn-secondary-full" data-action="toggle-add-account">
         ${showAddForm ? 'Скрыть форму входа' : 'Добавить другой аккаунт'}
       </button>`
    : '';

  const formHtml =
    !hasAccount || showAddForm
      ? `<div class="segmented-control cols-2 ${hasAccount ? 'mt-12' : ''}">
           <button type="button" class="seg-btn ${activeTab === 'youtube' ? 'active' : ''}" data-action="set-account-tab" data-account-tab="youtube">YouTube</button>
           <button type="button" class="seg-btn ${activeTab === 'profile' ? 'active' : ''}" data-action="set-account-tab" data-account-tab="profile">Профиль</button>
         </div>
         ${
           activeTab === 'youtube'
             ? `<form id="account-youtube-form" class="mt-8">
                  <label class="field-label" for="account-yt-channel">Канал YouTube или @никнейм</label>
                  <input id="account-yt-channel" class="ios-field" type="text" placeholder="@username или https://youtube.com/@..." required autocomplete="username" />
                  <p class="modal-desc">Укажите ваш @handle, название или ссылку на канал — подтянутся профиль и открытые плейлисты.</p>
                  <button type="submit" class="btn-primary-full" ${loading ? 'disabled' : ''}>
                    ${loading ? 'Входим…' : 'Войти через YouTube'}
                  </button>
                </form>`
             : `<form id="account-profile-form" class="mt-8">
                  <label class="field-label" for="account-profile-name">Имя или ник</label>
                  <input id="account-profile-name" class="ios-field" type="text" placeholder="Например: Алексей" required autocomplete="name" />
                  <label class="field-label" for="account-profile-email">Email (необязательно)</label>
                  <input id="account-profile-email" class="ios-field" type="email" placeholder="name@example.com" autocomplete="email" />
                  <button type="submit" class="btn-primary-full">Войти в профиль</button>
                </form>`
         }`
      : '';

  return `
    <h3 class="modal-title">${hasAccount ? 'Аккаунт' : 'Вход в аккаунт'}</h3>
    ${!hasAccount ? '<p class="modal-desc">Войдите через канал YouTube или создайте личный профиль Sonora.</p>' : ''}
    ${statusMessage ? `<div class="modal-status-msg">${escapeHtml(statusMessage)}</div>` : ''}
    ${profileCardHtml}
    ${formHtml}
    ${
      hasAccount
        ? `<button type="button" class="btn-danger-full" data-action="remove-current-account" data-account-id="${escapeHtml(acc.id)}">Выйти из аккаунта</button>`
        : ''
    }
    <button type="button" class="btn-secondary-full" data-action="close-modal">Закрыть</button>
  `;
}

export function buildCatalogSourcesModalHtml({
  customApiBaseUrl,
  activeSourceLabel,
  diagnosticsHtml
}) {
  return `
    <h3 class="modal-title">Источники каталога (без серверов)</h3>
    <p class="modal-desc">
      Sonora работает напрямую в браузере и параллельно опрашивает пул публичных узлов <b>Piped</b>, <b>Invidious</b> и <b>Audius</b> без рекламы.
      Сейчас активен: <b>${escapeHtml(activeSourceLabel)}</b>.
    </p>
    <form id="catalog-sources-form" class="routing-form">
      <label class="field-label" for="custom-api-url">Приоритетный Piped API узел (HTTPS, необязательно)</label>
      <input id="custom-api-url" class="ios-field" type="url" placeholder="https://pipedapi.example.com" value="${escapeHtml(customApiBaseUrl)}" />
      <button type="button" class="btn-secondary-full" data-action="test-catalog-health">Проверить доступность источников</button>
      ${diagnosticsHtml ? `<div class="helper-box">${diagnosticsHtml}</div>` : ''}
      <button type="submit" class="btn-primary-full">Сохранить</button>
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

export function buildTrackVersionsModalHtml(seedTrack, grouped, { loadingCatalog = false, getSafeThumb } = {}) {
  const safeSeedId = escapeHtml(seedTrack?.id || '');
  const sections = [
    { label: 'Оригинал', tracks: grouped?.originals || [] },
    { label: 'Ремиксы', tracks: grouped?.remixes || [] },
    { label: 'Каверы', tracks: grouped?.covers || [] },
    { label: 'Концертные записи', tracks: grouped?.live || [] },
    { label: 'Slowed / Sped Up / Акустика', tracks: grouped?.other || [] }
  ].filter((sec) => sec.tracks.length > 0);

  const thumbFn = typeof getSafeThumb === 'function' ? getSafeThumb : (t) => t?.thumbnailUrl || 'icons/icon-192.png';

  const sectionsHtml =
    sections.length > 0
      ? sections
          .map(
            (sec) => `
          <div class="settings-group-title">${escapeHtml(sec.label)} (${sec.tracks.length})</div>
          <div class="grouped-card modal-preview-list">
            ${sec.tracks
              .map((t) => {
                const badge = VERSION_LABELS_RU[t.versionType] || VERSION_LABELS_RU.original;
                return `
                  <button type="button" class="track-row ${t.id === seedTrack?.id ? 'active-track' : ''}" data-action="play-version-track" data-track-id="${escapeHtml(t.id)}">
                    <img src="${escapeHtml(thumbFn(t))}" alt="" class="track-thumb" loading="lazy" />
                    <div class="track-meta">
                      <div class="track-title">${escapeHtml(t.title)} <span class="version-pill">${escapeHtml(badge)}</span></div>
                      <div class="track-sub">${escapeHtml(t.artist)}</div>
                    </div>
                  </button>`;
              })
              .join('')}
          </div>`
          )
          .join('')
      : '<p class="modal-desc">Связанные версии пока не найдены.</p>';

  return `
    <h3 class="modal-title">Версии и ремиксы</h3>
    <p class="modal-sub-title">${escapeHtml(grouped?.baseTitle || seedTrack?.title || '')} • ${escapeHtml(seedTrack?.artist || '')}</p>
    ${
      loadingCatalog
        ? '<div class="modal-status-msg">Ищем оригинал, ремиксы и каверы в каталоге…</div>'
        : `<button type="button" class="btn-primary-full" data-action="search-more-versions" data-track-id="${safeSeedId}">Найти ещё версии в каталоге</button>`
    }
    ${sectionsHtml}
    <button type="button" class="btn-secondary-full mt-12" data-action="close-modal">Закрыть</button>
  `;
}

export function buildListeningStatsModalHtml(stats, moodLabelFn) {
  const tod = stats?.timeOfDayCounts || { morning: 0, day: 0, evening: 0, night: 0 };
  const todTotal = Math.max(1, (tod.morning || 0) + (tod.day || 0) + (tod.evening || 0) + (tod.night || 0));
  const todRows = [
    { label: 'Утро (05–11)', count: tod.morning || 0 },
    { label: 'День (12–16)', count: tod.day || 0 },
    { label: 'Вечер (17–22)', count: tod.evening || 0 },
    { label: 'Ночь (23–04)', count: tod.night || 0 }
  ];

  const moodChips = (stats?.topMoods || [])
    .map((m) => (typeof moodLabelFn === 'function' ? moodLabelFn(m) : m))
    .filter(Boolean);
  const tagChips = [...(stats?.topGenres || []), ...moodChips];

  const topTracksHtml =
    (stats?.topTracks || []).length > 0
      ? `<div class="grouped-card">
          ${stats.topTracks
            .map(
              (t, idx) => `
            <div class="track-row">
              <span class="track-index-num">${idx + 1}</span>
              <div class="track-meta">
                <div class="track-title">${escapeHtml(t.title)}</div>
                <div class="track-sub">${escapeHtml(t.artist)} • ${t.playCount || 0} включ. • ${t.completeCount || 0} до конца</div>
              </div>
            </div>`
            )
            .join('')}
        </div>`
      : '<p class="modal-desc">Послушайте несколько треков, чтобы собрать персональную статистику.</p>';

  return `
    <h3 class="modal-title">Статистика прослушиваний</h3>
    <p class="modal-sub-title">Пик активности: ${escapeHtml(stats?.peakTimeOfDayRu || 'Вечер')}</p>
    <div class="grouped-card">
      <div class="stats-grid-pad">
        <div class="stat-tile">
          <div class="stat-val">${stats?.totalPlays || 0}</div>
          <div class="stat-lbl">Включений</div>
        </div>
        <div class="stat-tile">
          <div class="stat-val">${stats?.completionRatePct || 0}%</div>
          <div class="stat-lbl">Дослушано</div>
        </div>
        <div class="stat-tile">
          <div class="stat-val">${stats?.totalListenedMinutes || 0}</div>
          <div class="stat-lbl">Минут</div>
        </div>
      </div>
    </div>

    <div class="settings-group-title">Активность по времени суток</div>
    <div class="stats-bars-card">
      ${todRows
        .map((r) => {
          const pct = Math.round((r.count / todTotal) * 100);
          return `
          <div class="stats-bar-row">
            <div class="stats-bar-meta">
              <span>${escapeHtml(r.label)}</span>
              <span>${r.count} (${pct}%)</span>
            </div>
            <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%"></div></div>
          </div>`;
        })
        .join('')}
    </div>

    ${
      tagChips.length > 0
        ? `<div class="settings-group-title">Любимые жанры и настроение</div>
           <div class="chips-row">
             ${tagChips.map((tag) => `<span class="chip-btn">${escapeHtml(tag)}</span>`).join('')}
           </div>`
        : ''
    }

    ${
      (stats?.topArtists || []).length > 0
        ? `<div class="settings-group-title">Частые исполнители</div>
           <div class="helper-box">${escapeHtml(stats.topArtists.join(' • '))}</div>`
        : ''
    }

    <div class="settings-group-title">Топ треков</div>
    ${topTracksHtml}
    <button type="button" class="btn-secondary-full mt-12" data-action="close-modal">Закрыть</button>
  `;
}

