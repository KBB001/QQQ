/**
 * SmartRecommendationEngine + TrackMoodProfiler + TasteSignalTracker
 * Умная система рекомендаций, распознавания версий/ремиксов и совместного вкуса.
 */

import { parseTrackVersionInfo } from './security.js';

export const MoodCategory = {
  ENERGETIC: 'ENERGETIC',
  WORKOUT_DRIVE: 'WORKOUT_DRIVE',
  CHILL_FOCUS: 'CHILL_FOCUS',
  NIGHT_SYNTH: 'NIGHT_SYNTH',
  ACOUSTIC_CALM: 'ACOUSTIC_CALM',
  MELANCHOLIC: 'MELANCHOLIC',
  JAZZ_LOUNGE: 'JAZZ_LOUNGE',
  GENERAL: 'GENERAL'
};

export const TempoTier = {
  SLOW: 0,
  MEDIUM: 1,
  UPBEAT: 2,
  HIGH_ENERGY: 3
};

export const ImplicitSignalType = {
  REPEAT_PLAY: 'REPEAT_PLAY',
  FAVORITE_ADDED: 'FAVORITE_ADDED',
  DOWNLOADED: 'DOWNLOADED',
  COMPLETE_PLAY: 'COMPLETE_PLAY',
  PARTIAL_SKIP: 'PARTIAL_SKIP',
  FAVORITE_REMOVED: 'FAVORITE_REMOVED',
  QUICK_SKIP: 'QUICK_SKIP'
};

export const VERSION_LABELS_RU = {
  original: 'Оригинал',
  remix: 'Ремикс',
  cover: 'Кавер',
  live: 'Концерт',
  slowed: 'Slowed',
  sped_up: 'Sped Up',
  acoustic: 'Акустика',
  instrumental: 'Минус'
};

const MOOD_KEYWORDS = {
  [MoodCategory.WORKOUT_DRIVE]: [
    'phonk', 'gym', 'workout', 'drift', 'hardstyle', 'bass boosted', 'metal', 'trap', 'трениров', 'спорт', 'фитнес'
  ],
  [MoodCategory.ENERGETIC]: [
    'dance', 'edm', 'house', 'club', 'party', 'pop', 'disco', 'remix', 'upbeat', 'весел', 'электрон', 'драйв', 'хит'
  ],
  [MoodCategory.NIGHT_SYNTH]: [
    'synthwave', 'retrowave', 'cyberpunk', 'vaporwave', 'outrun', 'night drive', 'darksynth', 'синтвейв', 'ночн'
  ],
  [MoodCategory.CHILL_FOCUS]: [
    'lofi', 'lo-fi', 'chillhop', 'focus', 'study', 'ambient', 'instrumental', 'beats to', 'фокус', 'работ', 'учеб', 'чилл'
  ],
  [MoodCategory.ACOUSTIC_CALM]: [
    'acoustic', 'unplugged', 'folk', 'guitar', 'indie', 'singer', 'piano', 'акустик', 'гитар', 'спокойн'
  ],
  [MoodCategory.MELANCHOLIC]: [
    'slowed', 'reverb', 'sad', 'melancholy', 'ballad', 'cry', 'lonely', 'грустн', 'лирик', 'печаль'
  ],
  [MoodCategory.JAZZ_LOUNGE]: [
    'jazz', 'blues', 'bossa', 'lounge', 'sax', 'soul', 'джаз', 'блюз'
  ]
};

const COMPATIBLE_MOODS = {
  [MoodCategory.ENERGETIC]: new Set([MoodCategory.WORKOUT_DRIVE, MoodCategory.NIGHT_SYNTH]),
  [MoodCategory.WORKOUT_DRIVE]: new Set([MoodCategory.ENERGETIC, MoodCategory.NIGHT_SYNTH]),
  [MoodCategory.NIGHT_SYNTH]: new Set([MoodCategory.ENERGETIC, MoodCategory.CHILL_FOCUS]),
  [MoodCategory.CHILL_FOCUS]: new Set([MoodCategory.ACOUSTIC_CALM, MoodCategory.JAZZ_LOUNGE, MoodCategory.NIGHT_SYNTH]),
  [MoodCategory.ACOUSTIC_CALM]: new Set([MoodCategory.CHILL_FOCUS, MoodCategory.MELANCHOLIC, MoodCategory.JAZZ_LOUNGE]),
  [MoodCategory.MELANCHOLIC]: new Set([MoodCategory.ACOUSTIC_CALM, MoodCategory.CHILL_FOCUS]),
  [MoodCategory.JAZZ_LOUNGE]: new Set([MoodCategory.CHILL_FOCUS, MoodCategory.ACOUSTIC_CALM]),
  [MoodCategory.GENERAL]: new Set([MoodCategory.ENERGETIC, MoodCategory.CHILL_FOCUS, MoodCategory.ACOUSTIC_CALM])
};

const SLOW_MODIFIERS = new Set([
  'slowed', 'reverb', 'acoustic', 'piano', 'lofi', 'lo-fi', 'chill', 'ambient',
  'sleep', 'study', 'ballad', 'sad', 'unplugged', 'lullaby', 'медляк', 'акустика', 'спокойн', 'грустное'
]);

const FAST_MODIFIERS = new Set([
  'remix', 'nightcore', 'sped up', 'speed up', 'phonk', 'techno', 'house', 'dnb',
  'drum', 'bass', 'hardstyle', 'workout', 'gym', 'club', 'rave', 'rock', 'metal', 'edm', 'ремикс', 'тренировка'
]);

const GENRE_WHITELIST = new Set([
  'rock', 'pop', 'rap', 'hip', 'hop', 'jazz', 'blues', 'lofi', 'synthwave',
  'house', 'techno', 'indie', 'metal', 'folk', 'acoustic', 'ambient', 'phonk',
  'edm', 'remix', 'live', 'instrumental', 'piano', 'guitar', 'soul', 'funk', 'electronic',
  'рок', 'поп', 'рэп', 'джаз', 'акустика', 'инди', 'электроника', 'металл'
]);

const MOOD_LABELS_RU = {
  [MoodCategory.ENERGETIC]: 'Энергичный драйв',
  [MoodCategory.WORKOUT_DRIVE]: 'Для тренировки и драйва',
  [MoodCategory.CHILL_FOCUS]: 'Для работы и фокуса',
  [MoodCategory.NIGHT_SYNTH]: 'Ночной синтвейв',
  [MoodCategory.ACOUSTIC_CALM]: 'Спокойная акустика',
  [MoodCategory.MELANCHOLIC]: 'Грустное и лиричное',
  [MoodCategory.JAZZ_LOUNGE]: 'Джаз и лаунж',
  [MoodCategory.GENERAL]: 'Ваш ежедневный поток'
};

export function groupTrackVersions(seedTrack, catalogPool = []) {
  if (!seedTrack) {
    return { canonicalKey: '', baseTitle: '', originals: [], remixes: [], covers: [], live: [], other: [], all: [] };
  }
  const seedInfo =
    seedTrack.canonicalKey && seedTrack.baseTitle
      ? {
          versionType: seedTrack.versionType || 'original',
          baseTitle: seedTrack.baseTitle,
          canonicalKey: seedTrack.canonicalKey
        }
      : parseTrackVersionInfo(seedTrack.title, seedTrack.artist);

  const normBase = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');

  const seedBaseNorm = normBase(seedInfo.baseTitle);
  const seedKey = seedInfo.canonicalKey;

  const uniqueMap = new Map();
  const candidates = [seedTrack, ...(Array.isArray(catalogPool) ? catalogPool : [])];

  for (const item of candidates) {
    if (!item?.id || uniqueMap.has(item.id)) continue;
    const info =
      item.canonicalKey && item.baseTitle
        ? {
            versionType: item.versionType || 'original',
            baseTitle: item.baseTitle,
            canonicalKey: item.canonicalKey
          }
        : parseTrackVersionInfo(item.title, item.artist);

    const keyMatch = Boolean(seedKey && info.canonicalKey && info.canonicalKey === seedKey);
    const baseMatch =
      !keyMatch &&
      seedBaseNorm.length >= 3 &&
      normBase(info.baseTitle) === seedBaseNorm &&
      (item.id === seedTrack.id ||
        info.versionType !== 'original' ||
        seedInfo.versionType !== 'original');

    if (keyMatch || baseMatch) {
      uniqueMap.set(item.id, {
        ...item,
        versionType: info.versionType,
        baseTitle: info.baseTitle,
        canonicalKey: info.canonicalKey || seedKey
      });
    }
  }

  const orderRank = {
    original: 0,
    acoustic: 1,
    live: 2,
    remix: 3,
    slowed: 4,
    sped_up: 5,
    cover: 6,
    instrumental: 7
  };

  const all = Array.from(uniqueMap.values()).sort(
    (a, b) => (orderRank[a.versionType] ?? 9) - (orderRank[b.versionType] ?? 9)
  );

  return {
    canonicalKey: seedKey,
    baseTitle: seedInfo.baseTitle,
    originals: all.filter((t) => t.versionType === 'original'),
    remixes: all.filter((t) => t.versionType === 'remix'),
    covers: all.filter((t) => t.versionType === 'cover'),
    live: all.filter((t) => t.versionType === 'live'),
    other: all.filter((t) => !['original', 'remix', 'cover', 'live'].includes(t.versionType)),
    all
  };
}

export function buildCoOccurrenceMap(playlists = [], extraPools = []) {
  const coMap = new Map();
  const addGroup = (tracks) => {
    if (!Array.isArray(tracks) || tracks.length < 2) return;
    const uniqueIds = Array.from(new Set(tracks.map((t) => t?.id).filter(Boolean))).slice(0, 80);
    for (let i = 0; i < uniqueIds.length; i++) {
      const a = uniqueIds[i];
      if (!coMap.has(a)) coMap.set(a, new Map());
      const aNeighbors = coMap.get(a);
      for (let j = 0; j < uniqueIds.length; j++) {
        if (i === j) continue;
        const b = uniqueIds[j];
        aNeighbors.set(b, (aNeighbors.get(b) || 0) + 1);
      }
    }
  };

  for (const pl of Array.isArray(playlists) ? playlists : []) {
    addGroup(pl?.tracks);
  }
  for (const pool of Array.isArray(extraPools) ? extraPools : []) {
    addGroup(pool);
  }
  return coMap;
}

export function diversifyRecommendations(tracks = [], moodProfiler = new TrackMoodProfiler()) {
  if (!Array.isArray(tracks) || tracks.length <= 1) return tracks || [];
  const remaining = [...tracks];
  const result = [];
  const seenCanonicalKeys = new Map();

  while (remaining.length > 0) {
    const prev = result[result.length - 1] || null;
    const prevArtist = prev ? moodProfiler.normalizeArtist(prev.artist) : '';
    const prevKey = prev
      ? prev.canonicalKey || parseTrackVersionInfo(prev.title, prev.artist).canonicalKey
      : '';

    let chosenIdx = -1;
    // Pass 1: avoid both consecutive artist AND any already-used canonical song version
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const artist = moodProfiler.normalizeArtist(cand.artist);
      const key = cand.canonicalKey || parseTrackVersionInfo(cand.title, cand.artist).canonicalKey;
      const sameArtistAsPrev = prevArtist && prevArtist !== 'unknown' && artist === prevArtist;
      const sameVersionAsPrev = prevKey && key && key === prevKey;
      const repeatedVersionCount = key ? seenCanonicalKeys.get(key) || 0 : 0;
      if (!sameArtistAsPrev && !sameVersionAsPrev && repeatedVersionCount === 0) {
        chosenIdx = i;
        break;
      }
    }

    // Pass 2: avoid consecutive artist and consecutive same canonical version
    if (chosenIdx < 0) {
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const artist = moodProfiler.normalizeArtist(cand.artist);
        const key = cand.canonicalKey || parseTrackVersionInfo(cand.title, cand.artist).canonicalKey;
        const sameArtistAsPrev = prevArtist && prevArtist !== 'unknown' && artist === prevArtist;
        const sameVersionAsPrev = prevKey && key && key === prevKey;
        if (!sameArtistAsPrev && !sameVersionAsPrev) {
          chosenIdx = i;
          break;
        }
      }
    }

    // Pass 3: avoid consecutive same canonical version at least
    if (chosenIdx < 0) {
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const key = cand.canonicalKey || parseTrackVersionInfo(cand.title, cand.artist).canonicalKey;
        if (!prevKey || !key || key !== prevKey) {
          chosenIdx = i;
          break;
        }
      }
    }

    if (chosenIdx < 0) chosenIdx = 0;

    const [picked] = remaining.splice(chosenIdx, 1);
    const pickedInfo =
      picked.canonicalKey && picked.baseTitle && picked.versionType
        ? {
            versionType: picked.versionType,
            baseTitle: picked.baseTitle,
            canonicalKey: picked.canonicalKey
          }
        : parseTrackVersionInfo(picked.title, picked.artist);
    const pickedKey = picked.canonicalKey || pickedInfo.canonicalKey;
    if (pickedKey) {
      seenCanonicalKeys.set(pickedKey, (seenCanonicalKeys.get(pickedKey) || 0) + 1);
    }
    result.push(
      picked.canonicalKey && picked.baseTitle && picked.versionType
        ? picked
        : {
            ...picked,
            versionType: picked.versionType || pickedInfo.versionType,
            baseTitle: picked.baseTitle || pickedInfo.baseTitle,
            canonicalKey: pickedKey
          }
    );
  }

  return result;
}

export class TrackMoodProfiler {
  normalizeArtist(rawArtist) {
    return (
      String(rawArtist || '')
        .toLowerCase()
        .replace(/\b(topic|vevo|official|records|music)\b/gi, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ') || 'unknown'
    );
  }

  _tokenize(text) {
    return new Set(
      text
        .split(/[^\p{L}\p{N}]+/u)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    );
  }

  profile(track) {
    const moodTagsStr = Array.isArray(track?.moodTags) ? track.moodTags.join(' ') : '';
    const text = `${track?.title || ''} ${track?.artist || ''} ${track?.album || ''} ${track?.genre || ''} ${moodTagsStr}`.toLowerCase();
    const tokens = this._tokenize(text);
    const normalizedArtist = this.normalizeArtist(track?.artist);
    const duration = Number(track?.durationSeconds) || 0;
    const year = Number(track?.year) || 0;
    const genre = String(track?.genre || '').trim().toLowerCase();
    const versionInfo =
      track?.canonicalKey && track?.baseTitle
        ? {
            versionType: track.versionType || 'original',
            baseTitle: track.baseTitle,
            canonicalKey: track.canonicalKey
          }
        : parseTrackVersionInfo(track?.title || '', track?.artist || '');

    let detectedMood = null;
    let bestScore = 0;
    for (const [mood, keywords] of Object.entries(MOOD_KEYWORDS)) {
      let score = 0;
      for (const kw of keywords) {
        if (kw.includes(' ')) {
          if (text.includes(kw)) score += 3;
        } else if (tokens.has(kw) || text.includes(kw)) {
          score += 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        detectedMood = mood;
      }
    }

    if (!detectedMood) {
      if (duration >= 420) detectedMood = MoodCategory.CHILL_FOCUS;
      else if (duration > 0 && duration <= 165) detectedMood = MoodCategory.ENERGETIC;
      else detectedMood = MoodCategory.GENERAL;
    }

    const baseEnergyMap = {
      [MoodCategory.WORKOUT_DRIVE]: 0.88,
      [MoodCategory.ENERGETIC]: 0.78,
      [MoodCategory.NIGHT_SYNTH]: 0.64,
      [MoodCategory.GENERAL]: 0.54,
      [MoodCategory.JAZZ_LOUNGE]: 0.36,
      [MoodCategory.ACOUSTIC_CALM]: 0.30,
      [MoodCategory.CHILL_FOCUS]: 0.28,
      [MoodCategory.MELANCHOLIC]: 0.24
    };
    let energy = baseEnergyMap[detectedMood] ?? 0.54;
    for (const mod of SLOW_MODIFIERS) {
      if (tokens.has(mod) || text.includes(mod)) {
        energy -= 0.22;
        break;
      }
    }
    for (const mod of FAST_MODIFIERS) {
      if (tokens.has(mod) || text.includes(mod)) {
        energy += 0.20;
        break;
      }
    }
    if (duration > 0 && duration <= 160) energy += 0.06;
    else if (duration >= 360) energy -= 0.08;

    energy = Math.min(0.98, Math.max(0.05, energy));

    const explicitBpm = Number(track?.tempoBpm) || 0;
    const tempoBpm =
      explicitBpm >= 40 && explicitBpm <= 240 ? Math.round(explicitBpm) : Math.round(68 + energy * 96);

    let tempo = TempoTier.SLOW;
    if (tempoBpm >= 136 || energy >= 0.78) tempo = TempoTier.HIGH_ENERGY;
    else if (tempoBpm >= 114 || energy >= 0.56) tempo = TempoTier.UPBEAT;
    else if (tempoBpm >= 92 || energy >= 0.35) tempo = TempoTier.MEDIUM;

    const genreTokens = new Set(
      Array.from(tokens)
        .filter((t) => GENRE_WHITELIST.has(t) || t.length >= 4)
        .slice(0, 14)
    );
    if (genre) genreTokens.add(genre);

    return {
      mood: detectedMood,
      tempo,
      tempoBpm,
      energy,
      genre,
      year,
      moodTags: Array.isArray(track?.moodTags) ? track.moodTags : [],
      genreTokens,
      normalizedArtist,
      versionType: versionInfo.versionType,
      baseTitle: versionInfo.baseTitle,
      canonicalKey: versionInfo.canonicalKey
    };
  }

  similarityScore(seed, candidate) {
    let moodScore = 0.15;
    if (seed.mood === candidate.mood) moodScore = 1.0;
    else if (COMPATIBLE_MOODS[seed.mood]?.has(candidate.mood)) moodScore = 0.65;
    else if (seed.mood === MoodCategory.GENERAL || candidate.mood === MoodCategory.GENERAL) moodScore = 0.45;

    const bpmDiff = Math.abs((seed.tempoBpm || 110) - (candidate.tempoBpm || 110));
    const bpmScore = Math.max(0, 1 - bpmDiff / 70);
    const tempoDiff = Math.abs(seed.tempo - candidate.tempo);
    const tierScore = tempoDiff === 0 ? 1.0 : tempoDiff === 1 ? 0.6 : tempoDiff === 2 ? 0.25 : 0.05;
    const tempoScore = tierScore * 0.5 + bpmScore * 0.5;

    const energyScore = Math.min(1.0, Math.max(0.0, 1.0 - Math.abs(seed.energy - candidate.energy)));

    let tokenOverlap = 0;
    if (seed.genreTokens.size > 0 && candidate.genreTokens.size > 0) {
      let inter = 0;
      for (const t of seed.genreTokens) {
        if (candidate.genreTokens.has(t)) inter++;
      }
      const union = seed.genreTokens.size + candidate.genreTokens.size - inter;
      tokenOverlap = union > 0 ? inter / union : 0;
    }

    const explicitGenreMatch =
      seed.genre && candidate.genre && seed.genre === candidate.genre ? 0.14 : 0;

    let yearScore = 0;
    if (seed.year > 1900 && candidate.year > 1900) {
      const yDiff = Math.abs(seed.year - candidate.year);
      yearScore = yDiff <= 3 ? 0.08 : yDiff <= 8 ? 0.04 : 0;
    }

    const artistBonus =
      seed.normalizedArtist === candidate.normalizedArtist && seed.normalizedArtist !== 'unknown'
        ? 0.11
        : 0;

    return Math.min(
      1.2,
      Math.max(
        0,
        moodScore * 0.4 +
          tempoScore * 0.24 +
          energyScore * 0.18 +
          tokenOverlap * 0.1 +
          explicitGenreMatch +
          yearScore +
          artistBonus
      )
    );
  }

  searchQueryForMood(mood) {
    switch (mood) {
      case MoodCategory.ENERGETIC:
        return 'upbeat electronic dance hits music audio';
      case MoodCategory.WORKOUT_DRIVE:
        return 'workout phonk energetic bass music audio';
      case MoodCategory.CHILL_FOCUS:
        return 'lofi chillhop study focus beats audio';
      case MoodCategory.NIGHT_SYNTH:
        return 'synthwave retrowave midnight electronic music';
      case MoodCategory.ACOUSTIC_CALM:
        return 'acoustic indie chill guitar mellow music';
      case MoodCategory.MELANCHOLIC:
        return 'emotional ambient indie ballad slowed music';
      case MoodCategory.JAZZ_LOUNGE:
        return 'smooth jazz cafe lounge instrumental music';
      default:
        return 'popular music mix audio';
    }
  }

  contrastingMoodsFor(rejectedMood) {
    switch (rejectedMood) {
      case MoodCategory.WORKOUT_DRIVE:
      case MoodCategory.ENERGETIC:
        return [MoodCategory.CHILL_FOCUS, MoodCategory.ACOUSTIC_CALM, MoodCategory.NIGHT_SYNTH];
      case MoodCategory.CHILL_FOCUS:
      case MoodCategory.ACOUSTIC_CALM:
      case MoodCategory.MELANCHOLIC:
        return [MoodCategory.ENERGETIC, MoodCategory.NIGHT_SYNTH, MoodCategory.JAZZ_LOUNGE];
      case MoodCategory.NIGHT_SYNTH:
        return [MoodCategory.ACOUSTIC_CALM, MoodCategory.ENERGETIC, MoodCategory.CHILL_FOCUS];
      case MoodCategory.JAZZ_LOUNGE:
        return [MoodCategory.NIGHT_SYNTH, MoodCategory.ENERGETIC, MoodCategory.ACOUSTIC_CALM];
      default:
        return [MoodCategory.CHILL_FOCUS, MoodCategory.ENERGETIC, MoodCategory.NIGHT_SYNTH];
    }
  }

  moodLabelRu(mood) {
    return MOOD_LABELS_RU[mood] || MOOD_LABELS_RU[MoodCategory.GENERAL];
  }

  versionLabelRu(versionType) {
    return VERSION_LABELS_RU[versionType] || VERSION_LABELS_RU.original;
  }
}

const SIGNAL_WEIGHTS = {
  [ImplicitSignalType.REPEAT_PLAY]: 2.5,
  [ImplicitSignalType.FAVORITE_ADDED]: 2.0,
  [ImplicitSignalType.DOWNLOADED]: 1.8,
  [ImplicitSignalType.COMPLETE_PLAY]: 1.5,
  [ImplicitSignalType.PARTIAL_SKIP]: -0.45,
  [ImplicitSignalType.FAVORITE_REMOVED]: -1.5,
  [ImplicitSignalType.QUICK_SKIP]: -2.2
};

const MS_PER_DAY = 86_400_000;

function timeDecayFactor(lastTimestampMs, nowMs = Date.now()) {
  const elapsedDays = Math.max(0, nowMs - (Number(lastTimestampMs) || nowMs)) / MS_PER_DAY;
  return Math.min(1.0, Math.max(0.15, Math.exp(-0.05 * elapsedDays)));
}

export class TasteSignalTracker {
  constructor(storage, moodProfiler = new TrackMoodProfiler()) {
    this.storage = storage;
    this.moodProfiler = moodProfiler;
    this.trackScores = new Map();
    this.artistScores = new Map();
    this.moodScores = new Map();
    this.tempoScores = new Map();
    this._hydrated = false;
  }

  ensureHydrated() {
    if (this._hydrated) return;
    this.rehydrate();
  }

  rehydrate() {
    const entries = Array.isArray(this.storage?.affinities) ? this.storage.affinities : [];
    const now = Date.now();
    this.trackScores.clear();
    this.artistScores.clear();
    this.moodScores.clear();
    this.tempoScores.clear();

    for (const entity of entries) {
      if (!entity?.trackId) continue;
      this.trackScores.set(entity.trackId, entity);
      const decayed = (Number(entity.affinityScore) || 0) * timeDecayFactor(entity.lastInteractedAt, now);
      if (entity.normalizedArtist && entity.normalizedArtist !== 'unknown') {
        const cur = this.artistScores.get(entity.normalizedArtist) || 0;
        this.artistScores.set(entity.normalizedArtist, Math.min(20, Math.max(-12, cur + decayed)));
      }
      if (entity.moodName) {
        const cur = this.moodScores.get(entity.moodName) || 0;
        this.moodScores.set(entity.moodName, Math.min(20, Math.max(-12, cur + decayed * 0.5)));
      }
      if (entity.tempoName !== undefined) {
        const cur = this.tempoScores.get(entity.tempoName) || 0;
        this.tempoScores.set(entity.tempoName, Math.min(20, Math.max(-12, cur + decayed * 0.35)));
      }
    }
    this._hydrated = true;
  }

  async recordSignal(track, signalType) {
    if (!track?.id) return;
    this.ensureHydrated();
    const profile = this.moodProfiler.profile(track);
    const delta = SIGNAL_WEIGHTS[signalType] ?? 0;
    const now = Date.now();

    const existing = this.trackScores.get(track.id);
    const decayedExisting = existing
      ? existing.affinityScore * timeDecayFactor(existing.lastInteractedAt, now)
      : 0;
    const newAffinity = Math.min(15, Math.max(-8, decayedExisting + delta));

    const updated = {
      trackId: track.id,
      normalizedArtist: profile.normalizedArtist,
      moodName: profile.mood,
      tempoName: profile.tempo,
      completedCount: (existing?.completedCount || 0) + (signalType === ImplicitSignalType.COMPLETE_PLAY ? 1 : 0),
      repeatCount: (existing?.repeatCount || 0) + (signalType === ImplicitSignalType.REPEAT_PLAY ? 1 : 0),
      quickSkipCount: (existing?.quickSkipCount || 0) + (signalType === ImplicitSignalType.QUICK_SKIP ? 1 : 0),
      partialSkipCount: (existing?.partialSkipCount || 0) + (signalType === ImplicitSignalType.PARTIAL_SKIP ? 1 : 0),
      affinityScore: newAffinity,
      lastInteractedAt: now
    };

    this.trackScores.set(track.id, updated);
    if (profile.normalizedArtist !== 'unknown') {
      const cur = this.artistScores.get(profile.normalizedArtist) || 0;
      this.artistScores.set(profile.normalizedArtist, Math.min(20, Math.max(-12, cur + delta)));
    }
    const curMood = this.moodScores.get(profile.mood) || 0;
    this.moodScores.set(profile.mood, Math.min(20, Math.max(-12, curMood + delta * 0.5)));
    const curTempo = this.tempoScores.get(profile.tempo) || 0;
    this.tempoScores.set(profile.tempo, Math.min(20, Math.max(-12, curTempo + delta * 0.35)));

    await this.storage?.saveAffinityEntity?.(updated);
  }

  getPersonalAffinityBonus(track) {
    this.ensureHydrated();
    const profile = this.moodProfiler.profile(track);
    const now = Date.now();
    const entity = this.trackScores.get(track?.id);
    const trackComponent = entity
      ? (entity.affinityScore * timeDecayFactor(entity.lastInteractedAt, now)) / 10
      : 0;
    const artistComponent = Math.min(0.55, Math.max(-0.45, (this.artistScores.get(profile.normalizedArtist) || 0) / 16));
    const moodComponent = Math.min(0.45, Math.max(-0.35, (this.moodScores.get(profile.mood) || 0) / 20));
    const tempoComponent = Math.min(0.3, Math.max(-0.2, (this.tempoScores.get(profile.tempo) || 0) / 24));

    return Math.min(
      1.0,
      Math.max(-0.85, trackComponent * 0.45 + artistComponent * 0.3 + moodComponent * 0.15 + tempoComponent * 0.1)
    );
  }

  topPreferredMood(excludingMoods = new Set()) {
    this.ensureHydrated();
    let bestMood = null;
    let bestScore = 0.25;
    for (const [mood, score] of this.moodScores.entries()) {
      if (!excludingMoods.has(mood) && score > bestScore) {
        bestScore = score;
        bestMood = mood;
      }
    }
    return bestMood;
  }

  topPreferredArtists(limit = 3) {
    this.ensureHydrated();
    return Array.from(this.artistScores.entries())
      .filter(([, score]) => score > 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([artist]) => artist);
  }
}

export class SmartRecommendationEngine {
  constructor({ api, storage, moodProfiler = new TrackMoodProfiler(), tasteTracker = null }) {
    this.api = api;
    this.storage = storage;
    this.moodProfiler = moodProfiler;
    this.tasteTracker = tasteTracker || new TasteSignalTracker(storage, moodProfiler);
    this.sessionHeardIds = new Set();
  }

  markHeardInSession(trackId) {
    if (trackId) this.sessionHeardIds.add(trackId);
  }

  resetSessionHistory() {
    this.sessionHeardIds.clear();
  }

  rankCandidates(candidates, seedTrack, recentSkippedTracks = [], preferContrasting = false) {
    if (!Array.isArray(candidates) || candidates.length <= 1) return candidates || [];
    const seedProfile = seedTrack ? this.moodProfiler.profile(seedTrack) : null;
    const skippedProfiles = recentSkippedTracks.map((t) => this.moodProfiler.profile(t));
    const rejectedMoods = new Set(skippedProfiles.map((p) => p.mood));
    const rejectedArtists = new Set(
      skippedProfiles.map((p) => p.normalizedArtist).filter((a) => a !== 'unknown')
    );

    const scored = candidates.map((track, originalIndex) => {
      const profile = this.moodProfiler.profile(track);
      const soundMatch = seedProfile ? this.moodProfiler.similarityScore(seedProfile, profile) : 0.5;
      const tasteBonus = this.tasteTracker.getPersonalAffinityBonus(track);
      const statEntry = this.storage?.trackStats?.[track.id];
      const completionSignal = statEntry
        ? Math.min(0.25, ((statEntry.completeCount || 0) * 0.08) - ((statEntry.quickSkipCount || 0) * 0.12))
        : 0;

      let skipPenalty = 0;
      if (rejectedMoods.has(profile.mood)) {
        skipPenalty += preferContrasting ? -0.55 : -0.22;
      }
      if (rejectedArtists.has(profile.normalizedArtist)) {
        skipPenalty -= 0.35;
      }
      const contrastBoost = preferContrasting && !rejectedMoods.has(profile.mood) ? 0.25 : 0;
      const totalScore = soundMatch * 0.62 + tasteBonus * 0.42 + completionSignal + skipPenalty + contrastBoost;
      return { track, score: totalScore, originalIndex };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });
    return scored.map((s) => s.track);
  }

  softRerankUpcoming(upcomingTracks, seedTrack, recentSkippedTracks = []) {
    if (!Array.isArray(upcomingTracks) || upcomingTracks.length <= 1) return upcomingTracks || [];
    const ranked = this.rankCandidates(
      upcomingTracks,
      seedTrack,
      recentSkippedTracks,
      recentSkippedTracks.length >= 2
    );
    return diversifyRecommendations(ranked, this.moodProfiler);
  }

  getAlsoLikedTracks(seedTracks = [], pool = [], limit = 15, extraPools = []) {
    const seeds = (Array.isArray(seedTracks) ? seedTracks : [seedTracks]).filter((t) => t?.id);
    if (seeds.length === 0 || !Array.isArray(pool) || pool.length === 0) return [];

    const seedIds = new Set(seeds.map((s) => s.id));
    const seedKeys = new Set(seeds.map((s) => this.moodProfiler.profile(s).canonicalKey).filter(Boolean));
    const coMap = buildCoOccurrenceMap(this.storage?.library?.playlists || [], extraPools);

    const candidateMap = new Map();
    for (const t of pool) {
      if (!t?.id || seedIds.has(t.id)) continue;
      const key = this.moodProfiler.profile(t).canonicalKey;
      if (key && seedKeys.has(key)) continue;
      candidateMap.set(t.id, t);
    }

    const scored = [];
    for (const [id, cand] of candidateMap.entries()) {
      let coScore = 0;
      for (const seed of seeds) {
        coScore += coMap.get(seed.id)?.get(id) || 0;
      }
      const candProf = this.moodProfiler.profile(cand);
      let simSum = 0;
      for (const seed of seeds.slice(0, 3)) {
        simSum += this.moodProfiler.similarityScore(this.moodProfiler.profile(seed), candProf);
      }
      const avgSim = simSum / Math.min(3, seeds.length);
      const taste = this.tasteTracker.getPersonalAffinityBonus(cand);
      if (coScore > 0 || avgSim >= 0.45) {
        scored.push({
          track: cand,
          score: coScore * 1.4 + avgSim * 0.75 + taste * 0.35
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return diversifyRecommendations(
      scored.map((s) => s.track),
      this.moodProfiler
    ).slice(0, limit);
  }

  getSimilarToFavorites(pool = [], limit = 15) {
    const favs = this.storage?.library?.favorites || [];
    const topCompleted = Object.values(this.storage?.trackStats || {})
      .filter((s) => (s.completeCount || 0) > 0)
      .sort((a, b) => (b.completeCount || 0) - (a.completeCount || 0))
      .slice(0, 4);

    const seeds = [...favs.slice(0, 4), ...topCompleted].filter((t) => t?.id);
    if (seeds.length === 0 || pool.length === 0) return [];

    const seedIds = new Set(favs.map((t) => t.id));
    const seedKeys = new Set(seeds.map((s) => this.moodProfiler.profile(s).canonicalKey).filter(Boolean));

    const candidates = pool.filter((t) => {
      if (!t?.id || seedIds.has(t.id)) return false;
      const k = this.moodProfiler.profile(t).canonicalKey;
      return !k || !seedKeys.has(k);
    });
    if (candidates.length === 0) return [];

    const scored = candidates.map((cand) => {
      const candProfile = this.moodProfiler.profile(cand);
      let bestSim = 0;
      for (const s of seeds.slice(0, 5)) {
        const sim = this.moodProfiler.similarityScore(this.moodProfiler.profile(s), candProfile);
        if (sim > bestSim) bestSim = sim;
      }
      const taste = this.tasteTracker.getPersonalAffinityBonus(cand);
      return { track: cand, score: bestSim * 0.75 + taste * 0.4 };
    });

    scored.sort((a, b) => b.score - a.score);
    return diversifyRecommendations(
      scored.map((s) => s.track),
      this.moodProfiler
    ).slice(0, limit);
  }

  async generateNextQueueTracks(seedTrack, targetCount = 12, excludeIds = new Set(), recentSkippedTracks = []) {
    if (!seedTrack || targetCount <= 0) return [];
    this.tasteTracker.ensureHydrated();

    const seedKey = this.moodProfiler.profile(seedTrack).canonicalKey;
    const blocked = new Set([...excludeIds, ...this.sessionHeardIds, seedTrack.id]);
    const candidates = new Map();

    const addIfEligible = (t) => {
      if (!t?.id || blocked.has(t.id) || candidates.has(t.id)) return;
      const key = this.moodProfiler.profile(t).canonicalKey;
      if (seedKey && key && key === seedKey) return;
      candidates.set(t.id, t);
    };

    try {
      const related = await this.api.getRelatedTracks(seedTrack);
      for (const t of related) addIfEligible(t);
    } catch {
      // Ignore and use local/mood fallback below
    }

    const seedProfile = this.moodProfiler.profile(seedTrack);
    const skippedProfiles = recentSkippedTracks.map((t) => this.moodProfiler.profile(t));
    const rejectedMoods = new Set(skippedProfiles.map((p) => p.mood));

    if (candidates.size < targetCount || skippedProfiles.length >= 2) {
      let targetMood = seedProfile.mood;
      if (skippedProfiles.length >= 2) {
        const contrasting = this.moodProfiler.contrastingMoodsFor(
          skippedProfiles[skippedProfiles.length - 1].mood
        );
        targetMood =
          this.tasteTracker.topPreferredMood(rejectedMoods) || contrasting[0] || seedProfile.mood;
      }
      const q = this.moodProfiler.searchQueryForMood(targetMood);
      const fallback = await this.api.search(q, 'TRACKS').catch(() => []);
      for (const item of fallback) {
        const t = item.type === 'track' ? item : null;
        if (t) addIfEligible(t);
      }
    }

    if (candidates.size === 0) return [];
    const ranked = this.rankCandidates(
      Array.from(candidates.values()),
      seedTrack,
      recentSkippedTracks,
      skippedProfiles.length >= 2
    );
    return diversifyRecommendations(ranked, this.moodProfiler).slice(0, targetCount);
  }

  buildPersonalizedMixes(catalogTracks = [], extraPools = []) {
    this.tasteTracker.ensureHydrated();
    const favs = this.storage?.library?.favorites || [];
    const hist = this.storage?.library?.history || [];
    const plTracks = (this.storage?.library?.playlists || []).flatMap((pl) => pl.tracks || []);

    const poolMap = new Map();
    for (const t of [...favs, ...hist, ...plTracks, ...catalogTracks]) {
      if (t?.id && !poolMap.has(t.id)) {
        poolMap.set(t.id, t);
      }
    }
    const pool = Array.from(poolMap.values());
    const topMood = this.tasteTracker.topPreferredMood() || MoodCategory.GENERAL;
    const seed = favs[0] || hist[0] || pool[0] || null;
    const rankedRaw = seed ? this.rankCandidates(pool, seed) : pool;
    const rankedDaily = diversifyRecommendations(rankedRaw, this.moodProfiler);

    const preferredArtists = this.tasteTracker.topPreferredArtists(2);
    const subtitleParts = [this.moodProfiler.moodLabelRu(topMood)];
    if (preferredArtists.length > 0) {
      subtitleParts.push(preferredArtists.join(', '));
    }

    const madeForYou = [];
    const groupedByMood = new Map();
    for (const track of rankedDaily) {
      const m = this.moodProfiler.profile(track).mood;
      if (!groupedByMood.has(m)) groupedByMood.set(m, []);
      groupedByMood.get(m).push(track);
    }

    const moodOrder = [
      topMood,
      MoodCategory.ENERGETIC,
      MoodCategory.WORKOUT_DRIVE,
      MoodCategory.CHILL_FOCUS,
      MoodCategory.NIGHT_SYNTH,
      MoodCategory.ACOUSTIC_CALM,
      MoodCategory.MELANCHOLIC
    ];
    const usedIds = new Set();
    for (const moodKey of moodOrder) {
      if (usedIds.has(moodKey)) continue;
      usedIds.add(moodKey);
      const tracks = diversifyRecommendations(groupedByMood.get(moodKey) || [], this.moodProfiler);
      if (tracks.length >= 2) {
        madeForYou.push({
          id: `mix_${moodKey}`,
          title: moodKey === topMood ? 'Ваш главный микс' : this.moodProfiler.moodLabelRu(moodKey),
          subtitle: `${tracks.length} треков • Собрано для вас`,
          coverUrl: tracks[0]?.thumbnailUrl || '',
          tracks: tracks.slice(0, 20)
        });
      }
    }

    if (madeForYou.length === 0 && rankedDaily.length > 0) {
      madeForYou.push({
        id: 'mix_daily',
        title: 'Собрано для вас',
        subtitle: `${rankedDaily.length} треков • ${this.moodProfiler.moodLabelRu(topMood)}`,
        coverUrl: rankedDaily[0]?.thumbnailUrl || '',
        tracks: rankedDaily.slice(0, 20)
      });
    }

    const similarToFavorites = this.getSimilarToFavorites(pool, 15);
    const seedList = [...favs.slice(0, 3), ...hist.slice(0, 2)].filter(Boolean);
    const alsoLikedTracks =
      seedList.length > 0
        ? this.getAlsoLikedTracks(seedList, pool, 15, extraPools)
        : [];

    return {
      dailyMixTracks: rankedDaily.slice(0, 30),
      dailyMixSubtitle:
        rankedDaily.length > 0
          ? `${subtitleParts.join(' • ')}`
          : 'Бесконечный поток под ваш вкус',
      madeForYou,
      similarToFavorites,
      alsoLikedTracks
    };
  }
}
