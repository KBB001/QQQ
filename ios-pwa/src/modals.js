import { escapeHtml } from './security.js';

export const YOUTUBE_DIRECT_EXPORT_SNIPPET = `(async () => {
  if (!location.hostname.includes('youtube.com')) {
    alert('Откройте music.youtube.com под своим аккаунтом и запустите скрипт там.');
    return;
  }
  const cookieMap = Object.fromEntries(
    document.cookie.split(';').map((p) => {
      const i = p.indexOf('=');
      return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : ['', ''];
    })
  );
  const sapisid = cookieMap['__Secure-3PAPISID'] || cookieMap['SAPISID'] || '';
  if (!sapisid) {
    alert('Войдите в свой аккаунт на music.youtube.com и повторите запуск.');
    return;
  }
  const origin = 'https://music.youtube.com';
  const ts = Math.floor(Date.now() / 1000);
  const msg = ts + ' ' + sapisid + ' ' + origin;
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(msg));
  const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const auth = 'SAPISIDHASH ' + ts + '_' + hash;
  const ytPost = async (ep, body) => {
    const r = await fetch(origin + '/youtubei/v1/' + ep + '?prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth,
        'X-Origin': origin,
        'X-Goog-AuthUser': '0'
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250201.01.00', hl: 'ru', gl: 'RU' } },
        ...body
      })
    });
    return r.json();
  };
  const txt = (obj) => (obj?.runs || []).map((x) => x.text).join('') || obj?.simpleText || '';
  const walk = (root, fn) => {
    if (!root || typeof root !== 'object') return;
    fn(root);
    if (Array.isArray(root)) root.forEach((x) => walk(x, fn));
    else Object.values(root).forEach((v) => walk(v, fn));
  };
  const extractTracks = (json) => {
    const map = new Map();
    walk(json, (node) => {
      const m = node.musicResponsiveListItemRenderer || node.playlistVideoRenderer;
      if (!m) return;
      const vid = m.playlistItemData?.videoId || m.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId || m.videoId;
      if (!vid || map.has(vid)) return;
      const cols = m.flexColumns || [];
      const title = txt(cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text) || txt(m.title) || ('Track ' + vid);
      const artist = txt(cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text)?.split('•')[0]?.trim() || 'YouTube Music';
      const thumbs = m.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || m.thumbnail?.thumbnails || [];
      const thumbnailUrl = thumbs[thumbs.length - 1]?.url || ('https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg');
      map.set(vid, { id: vid, title, artist, durationSeconds: 0, thumbnailUrl });
    });
    return Array.from(map.values());
  };
  const [accJson, likedJson, histJson, plsJson] = await Promise.all([
    ytPost('account/account_menu', {}).catch(() => ({})),
    ytPost('browse', { browseId: 'FEmusic_liked_videos' }).catch(() => ({})),
    ytPost('browse', { browseId: 'FEmusic_history' }).catch(() => ({})),
    ytPost('browse', { browseId: 'FEmusic_liked_playlists' }).catch(() => ({}))
  ]);
  let account = { id: 'yt_export', name: 'YouTube Music', handle: '', email: '', avatarUrl: '' };
  walk(accJson, (n) => {
    if (n.activeAccountHeaderRenderer) {
      const h = n.activeAccountHeaderRenderer;
      account = {
        id: txt(h.channelHandle) || txt(h.accountName) || 'yt_export',
        name: txt(h.accountName) || 'YouTube Music',
        handle: txt(h.channelHandle) || '',
        email: txt(h.email) || '',
        avatarUrl: h.accountPhoto?.thumbnails?.[0]?.url || ''
      };
    }
  });
  const plItems = [];
  walk(plsJson, (n) => {
    const r = n.musicTwoRowItemRenderer;
    const bid = r?.navigationEndpoint?.browseEndpoint?.browseId;
    if (bid && (bid.startsWith('VL') || bid.startsWith('MPRE')) && !plItems.some((p) => p.browseId === bid)) {
      plItems.push({ browseId: bid, id: bid.replace(/^VL/, ''), name: txt(r.title) || 'Плейлист' });
    }
  });
  const playlists = [];
  for (const pl of plItems.slice(0, 15)) {
    const d = await ytPost('browse', { browseId: pl.browseId }).catch(() => ({}));
    playlists.push({ id: pl.id, name: pl.name, description: 'YouTube Music', tracks: extractTracks(d) });
  }
  const payload = JSON.stringify({
    format: 'sonora-yt-sync:v1',
    exportedAt: Date.now(),
    account,
    likedTracks: extractTracks(likedJson),
    historyTracks: extractTracks(histJson),
    playlists
  }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sonora-yt-library.json';
  a.click();
  try { await navigator.clipboard.writeText(payload); } catch {}
  alert('Готово! Файл sonora-yt-library.json скачан (и скопирован в буфер). Откройте Sonora и загрузите его.');
})();`;

export const YOUTUBE_EXPORT_BOOKMARKLET = `javascript:${encodeURIComponent(
  YOUTUBE_DIRECT_EXPORT_SNIPPET.replace(/\s*\n\s*/g, ' ').trim()
)}`;

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
    <button type="button" class="btn-secondary-full" data-action="menu-open-artist" data-track-id="${safeId}">Перейти к артисту</button>
    <button type="button" class="btn-secondary-full" data-action="menu-add-playlist" data-track-id="${safeId}">Добавить в плейлист</button>
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

export function buildYouTubeImportModalHtml({
  activeAccount,
  accounts,
  googleClientId = '',
  redirectUri = '',
  statusMessage
}) {
  const acc = activeAccount || {};
  const hasOAuth = acc.authType === 'google_oauth' && Boolean(acc.accessToken);
  const tokenValid = hasOAuth && (!acc.tokenExpiresAt || acc.tokenExpiresAt > Date.now() + 60_000);
  return `
    <h3 class="modal-title">Аккаунт YouTube и импорт</h3>
    <p class="modal-desc">
      Прямой вход через Google OAuth в браузере (без своего сервера) и быстрый мобильный импорт через закладку Safari.
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
    ${statusMessage ? `<div class="modal-status-msg">${escapeHtml(statusMessage)}</div>` : ''}

    <div class="helper-box">
      <div class="helper-title">1. Прямой вход через аккаунт Google / YouTube</div>
      ${
        hasOAuth
          ? `<div class="status-inline ${tokenValid ? 'ok' : 'warn'}">
               ${tokenValid ? `Подключён: ${escapeHtml(acc.name || acc.email || 'Google')}` : 'Срок сессии истёк — войдите повторно'}
             </div>
             ${
               tokenValid
                 ? `<button type="button" class="btn-primary-full mt-8" data-action="sync-google-oauth">Синхронизировать плейлисты сейчас</button>`
                 : ''
             }`
          : ''
      }
      <form id="google-oauth-form" class="mt-8">
        <label class="field-label" for="google-client-id-input">Google OAuth Client ID (Web)</label>
        <input id="google-client-id-input" class="ios-field" type="text" placeholder="1234567890-xxxx.apps.googleusercontent.com" value="${escapeHtml(googleClientId)}" />
        <button type="submit" class="btn-primary-full">${hasOAuth ? 'Войти / Сменить аккаунт Google' : 'Войти через Google / YouTube'}</button>
      </form>
      <details class="oauth-guide-details mt-8">
        <summary>Как за 1 минуту создать свой Client ID (бесплатно)</summary>
        <p class="modal-desc mt-8">
          1. Откройте Google Cloud Console → APIs &amp; Services → Credentials → Create OAuth Client ID (тип <b>Web application</b>).<br/>
          2. Включите <b>YouTube Data API v3</b> и добавьте ваш Redirect URI ниже в <b>Authorized redirect URIs</b> и origin сайта в <b>Authorized JavaScript origins</b>.<br/>
          3. Вставьте Client ID выше и нажмите «Войти через Google / YouTube».
        </p>
        ${
          redirectUri
            ? `<div class="oauth-uri-box">${escapeHtml(redirectUri)}</div>
               <button type="button" class="btn-secondary-full" data-action="copy-oauth-redirect-uri" data-uri="${escapeHtml(redirectUri)}">Скопировать Redirect URI</button>`
            : ''
        }
      </details>
    </div>

    <div class="helper-box">
      <div class="helper-title">2. Закладка Safari (iPhone) и импорт по ссылкам</div>
      <p class="modal-desc">
        Не требует Client ID: импортирует даже приватные миксы и историю из <b>music.youtube.com</b> через закладку или по ссылкам на плейлисты.
      </p>
      <button type="button" class="btn-primary-full" data-action="open-import-yt-playlist">Импорт по ссылкам (пакетно)</button>
      <button type="button" class="btn-secondary-full" data-action="copy-yt-bookmarklet">Скопировать закладку (Bookmarklet) для iPhone</button>
      <button type="button" class="btn-secondary-full" data-action="copy-yt-export-snippet">Скопировать скрипт для консоли (ПК)</button>
    </div>

    <form id="yt-import-form">
      <label class="field-label" for="yt-import-json">3. Вставить JSON / CSV Google Takeout или .sonoraenc</label>
      <textarea id="yt-import-json" class="ios-field ios-textarea" placeholder="Вставьте содержимое sonora-yt-library.json, watch-history.json или CSV из Google Takeout..."></textarea>
      <button type="submit" class="btn-primary-full">Импортировать вставленный текст</button>
    </form>

    <button type="button" class="btn-secondary-full" data-action="choose-yt-import-file">Выбрать файл (.json, .csv Takeout, .sonoraenc)</button>
    ${acc.id ? `<button type="button" class="btn-danger-full" data-action="remove-current-account" data-account-id="${escapeHtml(acc.id)}">Выйти и удалить профиль «${escapeHtml(acc.name)}»</button>` : ''}
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
