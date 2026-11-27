/**
 * SmartRecommendationEngine + TrackMoodProfiler + TasteSignalTracker
 * Полный перенос рекомендательного движка Sonora с Android на Web / iOS PWA.
 */

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

const MOOD_KEYWORDS = {
  [MoodCategory.WORKOUT_DRIVE]: [
    'phonk', 'gym', 'workout', 'drift', 'hardstyle', 'bass boosted', 'metal', 'trap', 'трениров', 'спорт'
  ],
  [MoodCategory.ENERGETIC]: [
    'dance', 'edm', 'house', 'club', 'party', 'pop', 'disco', 'remix', 'upbeat', 'электрон', 'драйв', 'хит'
  ],
  [MoodCategory.NIGHT_SYNTH]: [
    'synthwave', 'retrowave', 'cyberpunk', 'vaporwave', 'outrun', 'night drive', 'darksynth', 'синтвейв'
  ],
  [MoodCategory.CHILL_FOCUS]: [
    'lofi', 'lo-fi', 'chillhop', 'focus', 'study', 'ambient', 'instrumental', 'beats to', 'фокус', 'чилл'
  ],
  [MoodCategory.ACOUSTIC_CALM]: [
    'acoustic', 'unplugged', 'folk', 'guitar', 'indie', 'singer', 'piano', 'акустик', 'гитар'
  ],
  [MoodCategory.MELANCHOLIC]: [
    'slowed', 'reverb', 'sad', 'melancholy', 'ballad', 'cry', 'lonely', 'грустн', 'лирик'
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
  'sleep', 'study', 'ballad', 'sad', 'unplugged', 'lullaby', 'медляк', 'акустика', 'спокойн'
]);

const FAST_MODIFIERS = new Set([
  'remix', 'nightcore', 'sped up', 'speed up', 'phonk', 'techno', 'house', 'dnb',
  'drum', 'bass', 'hardstyle', 'workout', 'gym', 'club', 'rave', 'rock', 'metal', 'edm', 'ремикс'
]);

const GENRE_WHITELIST = new Set([
  'rock', 'pop', 'rap', 'hip', 'hop', 'jazz', 'blues', 'lofi', 'synthwave',
  'house', 'techno', 'indie', 'metal', 'folk', 'acoustic', 'ambient', 'phonk',
  'edm', 'remix', 'live', 'instrumental', 'piano', 'guitar', 'soul', 'funk',
  'рок', 'поп', 'рэп', 'джаз', 'акустика', 'инди', 'электроника'
]);

const MOOD_LABELS_RU = {
  [MoodCategory.ENERGETIC]: 'Энергичный драйв',
  [MoodCategory.WORKOUT_DRIVE]: 'Мощный ритм и фонк',
  [MoodCategory.CHILL_FOCUS]: 'Lo-Fi и фокус',
  [MoodCategory.NIGHT_SYNTH]: 'Ночной синтвейв',
  [MoodCategory.ACOUSTIC_CALM]: 'Тёплая акустика',
  [MoodCategory.MELANCHOLIC]: 'Атмосферная лирика',
  [MoodCategory.JAZZ_LOUNGE]: 'Джаз и лаунж',
  [MoodCategory.GENERAL]: 'Ваш ежедневный поток'
};

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
    const text = `${track?.title || ''} ${track?.artist || ''}`.toLowerCase();
    const tokens = this._tokenize(text);
    const normalizedArtist = this.normalizeArtist(track?.artist);
    const duration = Number(track?.durationSeconds) || 0;

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
    let tempo = TempoTier.SLOW;
    if (energy >= 0.78) tempo = TempoTier.HIGH_ENERGY;
    else if (energy >= 0.56) tempo = TempoTier.UPBEAT;
    else if (energy >= 0.35) tempo = TempoTier.MEDIUM;

    const genreTokens = new Set(
      Array.from(tokens)
        .filter((t) => GENRE_WHITELIST.has(t) || t.length >= 4)
        .slice(0, 12)
    );

    return {
      mood: detectedMood,
      tempo,
      energy,
      genreTokens,
      normalizedArtist
    };
  }

  similarityScore(seed, candidate) {
    let moodScore = 0.15;
    if (seed.mood === candidate.mood) moodScore = 1.0;
    else if (COMPATIBLE_MOODS[seed.mood]?.has(candidate.mood)) moodScore = 0.65;
    else if (seed.mood === MoodCategory.GENERAL || candidate.mood === MoodCategory.GENERAL) moodScore = 0.45;

    const tempoDiff = Math.abs(seed.tempo - candidate.tempo);
    const tempoScore = tempoDiff === 0 ? 1.0 : tempoDiff === 1 ? 0.6 : tempoDiff === 2 ? 0.25 : 0.05;
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

    const artistBonus =
      seed.normalizedArtist === candidate.normalizedArtist && seed.normalizedArtist !== 'unknown'
        ? 0.12
        : 0;

    return Math.min(
      1.15,
      Math.max(
        0,
        moodScore * 0.45 + tempoScore * 0.25 + energyScore * 0.2 + tokenOverlap * 0.1 + artistBonus
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
      let skipPenalty = 0;
      if (rejectedMoods.has(profile.mood)) {
        skipPenalty += preferContrasting ? -0.55 : -0.22;
      }
      if (rejectedArtists.has(profile.normalizedArtist)) {
        skipPenalty -= 0.35;
      }
      const contrastBoost = preferContrasting && !rejectedMoods.has(profile.mood) ? 0.25 : 0;
      const totalScore = soundMatch * 0.65 + tasteBonus * 0.45 + skipPenalty + contrastBoost;
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
    return this.rankCandidates(
      upcomingTracks,
      seedTrack,
      recentSkippedTracks,
      recentSkippedTracks.length >= 2
    );
  }

  async generateNextQueueTracks(seedTrack, targetCount = 12, excludeIds = new Set(), recentSkippedTracks = []) {
    if (!seedTrack || targetCount <= 0) return [];
    this.tasteTracker.ensureHydrated();

    const blocked = new Set([...excludeIds, ...this.sessionHeardIds, seedTrack.id]);
    const candidates = new Map();

    try {
      const related = await this.api.getRelatedTracks(seedTrack);
      for (const t of related) {
        if (t?.id && !blocked.has(t.id) && !candidates.has(t.id)) {
          candidates.set(t.id, t);
        }
      }
    } catch {
      // Ignore and search by mood below
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
        if (t?.id && !blocked.has(t.id) && !candidates.has(t.id)) {
          candidates.set(t.id, t);
        }
      }
    }

    if (candidates.size === 0) return [];
    return this.rankCandidates(
      Array.from(candidates.values()),
      seedTrack,
      recentSkippedTracks,
      skippedProfiles.length >= 2
    ).slice(0, targetCount);
  }

  buildPersonalizedMixes(catalogTracks = []) {
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
    const rankedDaily = seed ? this.rankCandidates(pool, seed) : pool;

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
      MoodCategory.CHILL_FOCUS,
      MoodCategory.NIGHT_SYNTH,
      MoodCategory.ACOUSTIC_CALM,
      MoodCategory.WORKOUT_DRIVE
    ];
    const usedIds = new Set();
    for (const moodKey of moodOrder) {
      if (usedIds.has(moodKey)) continue;
      usedIds.add(moodKey);
      const tracks = groupedByMood.get(moodKey) || [];
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

    return {
      dailyMixTracks: rankedDaily.slice(0, 30),
      dailyMixSubtitle:
        rankedDaily.length > 0
          ? `${subtitleParts.join(' • ')}`
          : 'Бесконечный поток под ваш вкус',
      madeForYou
    };
  }
}
