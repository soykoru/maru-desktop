/**
 * Mapa de métodos JSON-RPC por dominio.
 *
 * Convención: <dominio>.<acción>. Todos los nombres están en `kebab.snake_case`
 * para evitar colisiones con keywords y mantener consistencia con Python.
 */

import type {
  DataCategoryBundle,
  GameCategory,
  GameConnection,
  GameConnectionType,
  GameId,
  GameProfile,
  IaAskMeta,
  IaConfig,
  IaProvidersMeta,
  IaTestResult,
  LogCategory,
  LogEntry,
  LogStats,
  OverlayInfo,
  OverlaysIdentity,
  OverlaysListResult,
  PingResult,
  RelationshipType,
  SoundEvent,
  SoundLibraryItem,
  SoundsConfig,
  WordBombConfig,
  WordSearchConfig,
  Rule,
  SocialCategoryMeta,
  SocialConfig,
  SocialStats,
  SocialUser,
  SpotifyAccount,
  SpotifyConfig,
  SpotifyDevice,
  SpotifyNowPlaying,
  SpotifyQueueItem,
  SpotifyStatus,
  TapsPeriod,
  TapsRankingEntry,
  TikTokStats,
  TtsChannel,
  TtsConfig,
  TtsQueueSizes,
  TtsTestResult,
  TtsUserVoice,
  TtsVoice,
  BackupEntry,
  BackupReason,
  BackupScope,
  DataKind,
  DataEntry,
  ProfileSnapshot,
} from '../types/index.js';

export interface SystemMetrics {
  rssMb: number;
  cpuPercent: number;
  threadCount: number;
  busQueueSize: number;
  uptimeMs: number;
  tracemallocEnabled: boolean;
  psutilAvailable: boolean;
  topAlloc?:
    | {
        file: string;
        line: number;
        sizeMb: number;
        count: number;
      }[]
    | null;
}

export interface SystemMethods {
  'system.ping': { params: { echo?: string }; result: PingResult };
  'system.health': { params: Record<string, never>; result: { sidecarVersion: string; uptimeMs: number } };
  'system.metrics': { params: Record<string, never>; result: SystemMetrics };
  'system.shutdown': { params: Record<string, never>; result: { ok: true } };
}

export interface TikTokMethods {
  'tiktok.connect': { params: { username: string }; result: { ok: boolean; error?: string } };
  'tiktok.disconnect': { params: Record<string, never>; result: { ok: true } };
  'tiktok.status': {
    params: Record<string, never>;
    result: { connected: boolean; username?: string; stats?: TikTokStats };
  };
  /** Lee si hay API key de eulerstream configurada (devuelve enmascarada). */
  'tiktok.sign-key.get': {
    params: Record<string, never>;
    result: { hasKey: boolean; key: string };
  };
  /** Guarda la API key de eulerstream (string vacío = borrar). */
  'tiktok.sign-key.set': {
    params: { key: string };
    result: { ok: boolean; cleared?: boolean; message?: string };
  };
  // Simulador inline: inyecta eventos como si vinieran de TikTok.
  'simulator.gift': {
    params: { user: string; giftName: string; diamonds: number; count?: number };
    result: { ok: true };
  };
  'simulator.like': { params: { user: string; count?: number }; result: { ok: true } };
  'simulator.like-milestone': { params: { user?: string; total: number }; result: { ok: true } };
  'simulator.follow': { params: { user: string }; result: { ok: true } };
  'simulator.share': { params: { user: string }; result: { ok: true } };
  'simulator.comment': { params: { user: string; text: string }; result: { ok: true } };
  'simulator.command': {
    params: { user: string; command: string; args?: string };
    result: { ok: true };
  };
  'simulator.subscribe': {
    params: { user: string };
    result: { ok: true };
  };
  /** Simula JoinEvent (viewer entra al live). Acepta los mismos flags
   * de rango que los demás eventos para testear reglas con required_ranks. */
  'simulator.join': {
    params: {
      user: string;
      nickname?: string;
      isSuperFan?: boolean;
      isModerator?: boolean;
      isTopGifter?: boolean;
      isFollower?: boolean;
      memberLevel?: number;
      gifterLevel?: number;
      gameId?: string;
    };
    result: { ok: true };
  };
  /** Simula EmoteChatEvent (sticker/emote). */
  'simulator.emote': {
    params: {
      user: string;
      streamer?: string;
      emoteId?: string;
      imagePath?: string;
      gameId?: string;
    };
    result: { ok: true };
  };
}

export interface EmoteInfo {
  emoteId: string;
  path: string;
  soundPath: string;
  name: string;
  createdAt?: number;
}

export interface EmoteStreamer {
  username: string;
  displayName: string;
  avatar: string | null;
  emoteCount: number;
}

export interface EmotesMethods {
  'emotes.list-streamers': {
    params: Record<string, never>;
    result: { streamers: EmoteStreamer[] };
  };
  'emotes.list': {
    params: { streamer: string };
    result: { streamer: string; emotes: EmoteInfo[] };
  };
  'emotes.assign-sound': {
    params: { streamer: string; emoteId: string; soundPath: string };
    result: { ok: true; streamer: string; emoteId: string };
  };
  /** Reproduce el sonido enlazado a un emote (preview manual del botón "▶️ Probar"). */
  'emotes.preview-sound': {
    params: { streamer: string; emoteId: string };
    result: { ok: boolean; soundPath?: string; message?: string };
  };
  'emotes.delete': {
    params: { streamer: string; emoteId: string };
    result: { ok: true };
  };
  'emotes.delete-streamer': {
    params: { streamer: string };
    result: { ok: true };
  };
  'emotes.set-streamer-avatar': {
    params: { username: string; avatarUrl?: string; displayName?: string };
    result: { ok: true; streamer: string; avatarDownloaded: boolean };
  };
  /** Re-descarga el avatar del streamer desde la URL guardada en
   * manifest (o la que se pase). Reemplaza el avatar.png existente. */
  'emotes.refresh-avatar': {
    params: { streamer?: string; username?: string; avatarUrl?: string };
    result: { ok: boolean; streamer?: string; message?: string };
  };
}

/**
 * DonationGift — schema espejo del MARU original (`gifts.json:custom_gifts`).
 *
 * Estructura en disco:
 *   {
 *     "custom_gifts": {
 *       "<gift_id>": { "name", "icon", "coins", "icon_path", "disabled" }
 *     }
 *   }
 *
 * El `id` (key del dict en disco) preserva casing y espacios del nombre
 * original que TikTok envía: `"Heart Me"`, `"You're awesome"`, etc.
 *
 * `iconPath` es el path RELATIVO al bundle (`donaciones/<file>.png`)
 * — mejora respecto al MARU original que usaba absolute paths
 * `C:/Users/.../data/donaciones/Rose.png` (lo cual rompía portabilidad).
 *
 * `receivedCount` es una mejora del repo nuevo (no estaba en MARU): un
 * contador de gifts recibidos en la sesión actual, útil para el log.
 */
export interface DonationGift {
  /** Identidad estable. Casing original de TikTok (`Heart Me`, `Rose`, etc.) */
  id: string;
  /** Nombre traducido visible en UI (`"Corazóname"`, `"Rosa"`...). */
  name: string;
  /** Emoji fallback cuando no hay PNG. */
  icon: string;
  /** Valor en diamantes (0-999.999). */
  coins: number;
  /** Path relativo al scope `donaciones/` (`donaciones/Rose.png`). */
  iconPath: string;
  /** Si true, oculto en galería pero conserva metadata. Default false. */
  disabled?: boolean;
  /** Contador de la sesión actual. Reset al reconectar TikTok. Default 0. */
  receivedCount?: number;
}

export interface DonationsMethods {
  'donations.list': {
    params: { includeDisabled?: boolean };
    result: { gifts: DonationGift[] };
  };
  'donations.upsert': {
    params: { gift: DonationGift };
    result: { gift: DonationGift };
  };
  'donations.delete': { params: { id: string }; result: { ok: true } };
  'donations.reset-counters': {
    params: Record<string, never>;
    result: { ok: true };
  };
  /**
   * Escanea `data/donaciones/` (bundle + userdata) y devuelve catálogo
   * con metadata `tEXt` (Gift-Name, Gift-Coins) leída de cada PNG.
   * Réplica de `gifts_dialog.py:scan_donaciones_folder`.
   */
  'donations.scan-folder': {
    params: Record<string, never>;
    result: { catalog: DonationGift[] };
  };
  /**
   * Importa gifts del catálogo (skip los que ya existen y tienen PNG).
   * Devuelve cuántos se importaron + cuántos se actualizaron.
   */
  'donations.import-from-folder': {
    params: { overwriteExisting?: boolean };
    result: { imported: number; updated: number; skipped: number };
  };
}

/**
 * Payload para crear/actualizar una regla — el sidecar genera `id` si
 * falta y rellena los compat fields (`action_type` plano).
 */
export type RuleInput = Omit<
  Rule,
  'id' | 'action_type' | 'action_value' | 'amount' | 'commands'
> & {
  id?: string;
};

export interface RulesMethods {
  'rules.list': { params: { gameId: GameId }; result: { rules: Rule[] } };
  'rules.upsert': {
    params: { gameId: GameId; rule: RuleInput };
    result: { rule: Rule };
  };
  'rules.delete': {
    params: { gameId: GameId; ruleId: string };
    result: { ok: true };
  };
  'rules.toggle': {
    params: { gameId: GameId; ruleId: string; enabled: boolean };
    result: { ok: true };
  };
  'rules.reorder': {
    params: { gameId: GameId; orderedIds: string[] };
    result: { ok: true };
  };
  'rules.duplicate': {
    params: { gameId: GameId; ruleId: string };
    result: { rule: Rule };
  };
  'rules.test': {
    params: { gameId: GameId; ruleId: string };
    result: { ok: boolean; messages: string[] };
  };
  'rules.validate-all': {
    params: { gameId: GameId };
    result: {
      ok: boolean;
      problems: Array<{
        rule_name?: string;
        rule_index?: number;
        message: string;
        suggestion?: string | null;
        type: string;
        field?: string;
      }>;
      conflicts: Array<{ message: string; type?: string }>;
      error_count: number;
      warning_count: number;
      info_count: number;
      totalRules?: number;
      message?: string;
    };
  };
}

/** Métodos del KeyboardService — acciones de teclado en reglas (v1.0.97+). */
export interface KeyboardMethods {
  /** Ejecuta la combinación AHORA — usado por el botón "Probar" del editor.
   * Saltea el toggle global (`keyboardActionsEnabled`) porque el user
   * presionó el botón explícitamente. */
  'keyboard.test': {
    params: { keys: string; amount?: number; commands?: string };
    result: { ok: boolean; message: string };
  };
}

export interface DataMethods {
  'data.list': {
    params: { gameId: GameId; kind: DataKind; query?: string };
    result: { entries: DataEntry[]; total: number };
  };
  'data.upsert': {
    params: {
      gameId: GameId;
      kind: DataKind;
      entry: DataEntry;
      /** Para rename: nombre anterior. */
      previousName?: string;
    };
    result: { entry: DataEntry };
  };
  'data.delete': {
    params: { gameId: GameId; kind: DataKind; name: string };
    result: { ok: true };
  };
  /** v1.0.91+ — borrado masivo atómico (1 backup + 1 write para N nombres). */
  'data.bulk-delete': {
    params: { gameId: GameId; kind: DataKind; names: string[] };
    result: { removed: number; remaining: number; missing: string[] };
  };
  /** Acepta tanto `DataEntry[]` como `string[]` legacy `"Display:Cmd"`. */
  'data.import': {
    params: {
      gameId: GameId;
      kind: DataKind;
      entries: (DataEntry | string)[];
      replace?: boolean;
    };
    result: { added: number; total: number };
  };
  'data.export': {
    params: { gameId: GameId; kind: DataKind };
    result: { entries: DataEntry[] };
  };
  /**
   * Devuelve TODAS las categorías del juego con sus entries (con
   * `imagePath` resuelto contra el bundle si no hay uno en disco).
   * Usado por `EntitySelectorDialog` para los tabs.
   */
  'data.all-categories': {
    params: { gameId: GameId };
    result: { categories: Record<string, DataCategoryBundle> };
  };
  /**
   * Lee el tutorial declarado en `games.json[gid].categories[?id==kind].tutorial`.
   */
  'data.tutorial': {
    params: { gameId: GameId; kind: DataKind };
    result: { text: string };
  };
}

export interface ProfilesMethods {
  'profiles.list': {
    params: Record<string, never>;
    result: { profiles: ProfileSnapshot[] };
  };
  'profiles.save': {
    params: { name: string; description?: string };
    result: { profile: ProfileSnapshot };
  };
  'profiles.load': { params: { id: string }; result: { ok: true } };
  'profiles.duplicate': {
    params: { id: string; name: string };
    result: { profile: ProfileSnapshot };
  };
  'profiles.rename': {
    params: { id: string; name: string };
    result: { profile: ProfileSnapshot };
  };
  'profiles.delete': { params: { id: string }; result: { ok: true } };
  'profiles.export': { params: { id: string }; result: { json: string } };
  'profiles.import': {
    params: { json: string; name?: string };
    result: { profile: ProfileSnapshot };
  };
  /** v1.0.94+: portada custom del perfil. */
  'profiles.set-cover': {
    params: { id: string; sourcePath: string };
    result: { ok: boolean; filename?: string; message?: string };
  };
  'profiles.delete-cover': {
    params: { id: string };
    result: { ok: boolean; removed: number };
  };
  /** v1.0.95+: actualizar perfil existente sin crear duplicado. Solo
   *  per-game. Mantiene id/createdAt/coverImage/descripción; actualiza
   *  el snapshot (rules + data + sounds + boosts) + sha256 + updatedAt. */
  'profiles.update': {
    params: { id: string };
    result: { profile: ProfileSnapshot };
  };
}

export interface SoundsMethods {
  'sounds.list': {
    params: { scope?: string };
    result: SoundsConfig;
  };
  'sounds.library.add': {
    params: { scope?: string; paths: string[] };
    result: { ok: boolean; added: number; library: SoundLibraryItem[] };
  };
  'sounds.library.remove': {
    params: { scope?: string; path: string };
    result: { ok: boolean };
  };
  'sounds.assign-gift': {
    params: { scope?: string; giftId: string; path: string };
    result: { ok: boolean; giftId: string; path: string };
  };
  'sounds.assign-event': {
    params: { scope?: string; event: SoundEvent; path: string };
    result: { ok: boolean; event: SoundEvent; path: string };
  };
  'sounds.set-volume': {
    params: { scope?: string; volume: number };
    result: { ok: boolean; volume: number };
  };
  'sounds.resolve-path': {
    params: { path: string };
    result: SoundLibraryItem;
  };
  /** Detiene TODOS los sonidos en reproducción (usa pygame.mixer.stop). */
  'sounds.stop-all': {
    params: Record<string, never>;
    result: { ok: boolean; message?: string };
  };
}

export interface LogsMethods {
  /** Legacy F0 — devuelve líneas RAW del archivo. */
  'logs.tail': {
    params: {
      lines?: number;
      level?: 'debug' | 'info' | 'warning' | 'error';
    };
    result: { lines: string[] };
  };
  /** Snapshot del buffer estructurado en memoria (max 500). */
  'logs.list': {
    params: {
      categories?: LogCategory[];
      levels?: string[];
      query?: string;
      limit?: number;
    };
    result: { entries: LogEntry[]; total: number };
  };
  'logs.stats': {
    params: Record<string, never>;
    result: LogStats;
  };
  'logs.clear': {
    params: Record<string, never>;
    result: { ok: boolean };
  };
  'logs.reset-stats': {
    params: Record<string, never>;
    result: { ok: boolean };
  };
  'logs.categories': {
    params: Record<string, never>;
    result: {
      categories: LogCategory[];
      groups: Record<string, LogCategory[]>;
    };
  };
  /** Cargar las últimas N líneas del archivo al buffer en memoria. */
  'logs.hydrate-from-file': {
    params: { lines?: number };
    result: { loaded: number; bufferSize?: number };
  };
}

export interface MigrationItem {
  name: string;
  sizeBytes: number;
  existsInRuntime: boolean;
  currentRuntimeSize: number;
}

export interface MigrationStatus {
  found: boolean;
  originalDataDir: string | null;
  items: MigrationItem[];
  totalBytes: number;
  alreadyMigrated: boolean;
}

export interface MigrationsMethods {
  'migrations.status': {
    params: { originalPath?: string };
    result: MigrationStatus;
  };
  'migrations.apply': {
    params: { originalPath?: string; force?: boolean };
    result: {
      ok: boolean;
      applied: { name: string; sizeBytes: number }[];
      errors: { name: string; error: string }[];
      preBackupId: string | null;
      appliedAt: number;
    };
  };
}

/**
 * Payload de creación de un perfil custom — subset de `GameProfile`
 * sin los flags computados (`isStandard`, `hasEntities`...).
 */
export interface CreateCustomGameInput {
  id: GameId;
  name: string;
  icon: string;
  connection: GameConnection;
  connectionType: GameConnectionType;
  categories: GameCategory[];
  shareSounds: boolean;
  shareVoices: boolean;
  basedOn?: string;
  /** v1.0.74: portada custom (filename relativo a `game_covers/`). */
  coverImage?: string | null;
}

/**
 * Payload de update parcial — todo opcional.
 */
export interface UpdateGameInput {
  name?: string;
  icon?: string;
  connection?: GameConnection;
  connectionType?: GameConnectionType;
  tabNames?: { entities?: string; items?: string; events?: string };
  categories?: GameCategory[];
  shareSounds?: boolean;
  shareVoices?: boolean;
  /** v1.0.74: portada custom (filename relativo a `game_covers/`). Si null,
   *  borra la portada custom y vuelve a usar el bundle. */
  coverImage?: string | null;
}

export interface GamesMethods {
  'games.list': {
    params: Record<string, never>;
    result: { games: GameProfile[] };
  };
  /**
   * Editar host/port/password de un juego (predefinido o custom).
   * Para predefinidos solo afecta connection — no toca categories.
   */
  'games.configure': {
    params: { gameId: GameId; connection: GameConnection };
    result: { profile: GameProfile };
  };
  /**
   * Update parcial general — usado por CustomGameDialog.
   * Para predefinidos solo permite tocar `connection` y `tabNames`.
   */
  'games.update': {
    params: { gameId: GameId; patch: UpdateGameInput };
    result: { profile: GameProfile };
  };
  /** Crear nuevo perfil custom. ID debe ser único y no estándar. */
  'games.create-custom': {
    params: { profile: CreateCustomGameInput };
    result: { profile: GameProfile };
  };
  /**
   * Duplicar un perfil existente — copia data y crea rules vacías.
   * Réplica de `manage_games_dialog.py:create_profile_from`.
   */
  'games.duplicate': {
    params: {
      sourceId: GameId | 'empty';
      newId: GameId;
      newName: string;
      shareSounds: boolean;
      shareVoices: boolean;
    };
    result: { profile: GameProfile };
  };
  /** Borra el perfil custom + data_<gid>.json + rules_<gid>.json. */
  'games.delete-custom': {
    params: { gameId: GameId };
    result: { ok: true; deletedFiles: string[] };
  };
  'games.test': {
    params: { gameId: GameId; connection?: GameConnection };
    result: { ok: boolean; message: string };
  };
  'games.spawn': {
    params: { gameId: GameId; entity: string; amount: number; user?: string };
    result: { ok: boolean; message: string };
  };
  'games.give-item': {
    params: { gameId: GameId; item: string; amount: number; user?: string };
    result: { ok: boolean; message: string };
  };
  'games.trigger-event': {
    params: { gameId: GameId; event: string; user?: string };
    result: { ok: boolean; message: string };
  };
  /**
   * v1.0.71: genera la documentación maestra de cómo conectar juegos a
   * MARU como Markdown. Se rellena dinámicamente con los juegos
   * actualmente cargados. El renderer lo descarga vía save dialog.
   */
  'games-doc.get': {
    params: Record<string, never>;
    result: { markdown: string; filename: string; bytes: number };
  };
  /**
   * v1.0.74: subir portada custom para un juego (galería visual).
   * El backend copia `sourcePath` a `USERDATA/game_covers/<gameId>.<ext>`
   * y devuelve el filename. El caller debe llamar `games.update` con
   * `coverImage` igual al filename para persistir.
   */
  'images.set-game-cover': {
    params: { gameId: string; sourcePath: string };
    result: { ok: boolean; filename?: string; message?: string };
  };
  'images.delete-game-cover': {
    params: { gameId: string };
    result: { ok: boolean; removed?: number; message?: string };
  };
  /**
   * v1.0.72: snapshot del último resultado de healthcheck por juego.
   * El sidecar publica `game:health` periódicamente al EventBus; este RPC
   * sirve para que la UI tenga estado inicial al abrir el dialog sin
   * esperar 30s al próximo tick.
   */
  'games.health.snapshot': {
    params: Record<string, never>;
    result: { games: Record<string, GameHealthState> };
  };
}

/**
 * Estado de salud de un juego. Emitido por el sidecar al EventBus
 * (`game:health`) y disponible vía RPC `games.health.snapshot`.
 */
export interface GameHealthState {
  gameId: string;
  alive: boolean;
  latencyMs: number;
  message: string;
  /** ok: <1500ms · slow: 1500-5000ms · down: timeout/error */
  status: 'ok' | 'slow' | 'down';
  /** epoch ms del último tick */
  ts: number;
}

export interface SocialMethods {
  'social.command': {
    params: { user: string; text: string };
    result: { handled: boolean };
  };
  'social.config.get': {
    params: Record<string, never>;
    result: { config: SocialConfig };
  };
  'social.config.set': {
    params: { patch: Partial<SocialConfig> };
    result: { ok: boolean; error?: string };
  };
  'social.commands.meta': {
    params: Record<string, never>;
    result: { categories: Record<string, SocialCategoryMeta> };
  };
  'social.users.list': {
    params: { query?: string };
    result: { users: SocialUser[] };
  };
  'social.users.get': {
    params: { username: string };
    result: { user: SocialUser };
  };
  'social.users.register': {
    params: { username: string };
    result: { ok: boolean; error?: string };
  };
  'social.users.unregister': {
    params: { username: string };
    result: { ok: boolean; error?: string };
  };
  'social.users.delete': {
    params: { username: string };
    result: { ok: boolean; error?: string };
  };
  'social.users.set-racha': {
    params: { username: string; days: number };
    result: { ok: boolean; error?: string };
  };
  'social.users.reset-racha': {
    params: { username: string };
    result: { ok: boolean; error?: string };
  };
  'social.users.reset-relaciones': {
    params: { username: string };
    result: { ok: boolean; error?: string };
  };
  'social.users.remove-marriage': {
    params: { username: string };
    result: { ok: boolean; error?: string };
  };
  'social.users.remove-relationship': {
    params: { username: string; relType: RelationshipType };
    result: { ok: boolean; error?: string };
  };
  'social.users.activate-auto-racha': {
    params: {
      username: string;
      days?: number;
      /** "manual" (default) o "super_fan" — vinculada al rol del live. */
      kind?: 'manual' | 'super_fan';
    };
    result: { ok: boolean; message: string; kind?: 'manual' | 'super_fan' };
  };
  'social.users.deactivate-auto-racha': {
    params: { username: string };
    result: { ok: boolean; message: string };
  };
  'social.stats': {
    params: Record<string, never>;
    result: { stats: SocialStats };
  };
  'social.taps.top': {
    params: { period: TapsPeriod };
    result: {
      period: TapsPeriod;
      totalTaps: number;
      totalUsers: number;
      ranking: TapsRankingEntry[];
    };
  };
  'social.taps.cleanup': {
    params: Record<string, never>;
    result: { removed: number; error?: string };
  };
  'social.reset-all': {
    params: { confirm: 'DELETE' };
    result: { ok: boolean; resetAt?: number; message?: string };
  };
}

export interface SpotifyMethods {
  'spotify.status': {
    params: Record<string, never>;
    result: SpotifyStatus;
  };
  'spotify.now-playing': {
    params: Record<string, never>;
    result: SpotifyNowPlaying;
  };
  'spotify.play-request': {
    params: { user: string; query: string; priority?: boolean };
    result: { ok: boolean; message: string };
  };
  'spotify.skip': {
    params: Record<string, never>;
    result: { ok: boolean; message?: string };
  };
  'spotify.toggle-playback': {
    params: Record<string, never>;
    result: { ok: boolean; message: string };
  };
  'spotify.connect': {
    params: { clientId?: string; clientSecret?: string };
    result: { ok: boolean; message?: string };
  };
  'spotify.disconnect': {
    params: Record<string, never>;
    result: { ok: boolean };
  };
  'spotify.queue.list': {
    params: Record<string, never>;
    result: { items: SpotifyQueueItem[]; total: number };
  };
  'spotify.queue.clear': {
    params: Record<string, never>;
    result: { ok: boolean; message?: string };
  };
  'spotify.queue.remove': {
    params: { trackId: string };
    result: { ok: boolean; message?: string };
  };
  'spotify.devices': {
    params: Record<string, never>;
    result: { devices: SpotifyDevice[] };
  };
  'spotify.accounts.list': {
    params: Record<string, never>;
    result: { accounts: SpotifyAccount[] };
  };
  'spotify.accounts.save': {
    params: { name: string };
    result: { ok: boolean; message?: string };
  };
  'spotify.accounts.load': {
    params: { name: string };
    result: { ok: boolean; message?: string };
  };
  'spotify.accounts.delete': {
    params: { name: string };
    result: { ok: boolean; message?: string };
  };
  'spotify.config.get': {
    params: Record<string, never>;
    result: { config: SpotifyConfig };
  };
  'spotify.config.set': {
    params: { patch: Partial<SpotifyConfig> };
    result: { ok: boolean; config: SpotifyConfig };
  };
  'spotify.priority-user.set': {
    params: { username: string; uses: number };
    result: { ok: boolean; username: string; uses: number };
  };
  'spotify.priority-user.remove': {
    params: { username: string };
    result: { ok: boolean; removed: boolean };
  };
}

export interface IaMethods {
  'ia.status': {
    params: Record<string, never>;
    result: {
      ready: boolean;
      enabled: boolean;
      provider: string;
      model: string;
    };
  };
  'ia.config.get': {
    params: Record<string, never>;
    result: { config: IaConfig; ready: boolean };
  };
  'ia.config.set': {
    params: { patch: Partial<IaConfig> };
    result: { ok: boolean; config: IaConfig };
  };
  'ia.providers-meta': {
    params: Record<string, never>;
    result: IaProvidersMeta;
  };
  'ia.context.get': {
    params: Record<string, never>;
    result: { context: string; isDefault: boolean; default: string };
  };
  'ia.context.set': {
    params: { context: string };
    result: { ok: boolean; context: string };
  };
  'ia.ask': {
    params: { user: string; question: string };
    result: { ok: boolean; answer: string; meta?: IaAskMeta };
  };
  'ia.test': {
    params: { question?: string };
    result: IaTestResult;
  };
}

export interface TtsMethods {
  'tts.speak': {
    params: {
      text: string;
      channel?: TtsChannel;
      voice?: string;
      user?: string;
    };
    result: { ok: boolean; message?: string };
  };
  'tts.stop': { params: Record<string, never>; result: { ok: true } };
  'tts.queue-sizes': {
    params: Record<string, never>;
    result: TtsQueueSizes;
  };
  'tts.list-voices': {
    params: Record<string, never>;
    result: {
      voices: TtsVoice[];
      families: Record<string, string>;
      total: number;
    };
  };
  'tts.config.get': {
    params: Record<string, never>;
    result: { config: TtsConfig };
  };
  'tts.config.set': {
    params: { patch: Partial<TtsConfig> };
    result: { ok: boolean; config: TtsConfig };
  };
  'tts.user-voices.list': {
    params: Record<string, never>;
    result: { userVoices: TtsUserVoice[]; total: number };
  };
  'tts.user-voices.upsert': {
    params: { username: string; voice: string };
    result: { ok: boolean; username: string; voice: string };
  };
  'tts.user-voices.delete': {
    params: { username: string };
    result: { ok: boolean; removed: boolean };
  };
  'tts.user-voices.clear': {
    params: Record<string, never>;
    result: { ok: boolean; removed: number };
  };
  'tts.test': {
    params: { voice?: string; text?: string; username?: string };
    result: TtsTestResult;
  };
  'tts.clear-cache': {
    params: Record<string, never>;
    result: { ok: boolean; message?: string };
  };
}

/**
 * RPCs del relay v2 (`backend/overlays_relay.py`).
 *
 * Pass-through al Cloudflare Worker. MARU NO almacena configuraciones
 * de overlays; sólo el `userId` (namespace del DO) y un master switch
 * `enabled` viven localmente, en `data/overlays_identity.json`.
 */
export interface OverlaysMethods {
  'overlays.list': {
    params: Record<string, never>;
    result: OverlaysListResult;
  };
  'overlays.get-config': {
    params: { overlayId: string };
    result: { overlayId: string; config: Record<string, unknown> };
  };
  'overlays.set-config': {
    params: { overlayId: string; patch: Record<string, unknown> };
    result: { ok: true; config: Record<string, unknown> };
  };
  'overlays.test-event': {
    params: {
      overlayId: string;
      eventType?: string;
      data?: Record<string, unknown>;
    };
    result: { ok: boolean };
  };
  'overlays.reload': {
    params: { overlayId?: string };
    result: { ok: true };
  };
  'overlays.identity-get': {
    params: Record<string, never>;
    result: OverlaysIdentity;
  };
  'overlays.identity-set': {
    params: {
      userId?: string;
      enabled?: boolean;
      regenerate?: boolean;
    };
    result: OverlaysIdentity;
  };
  /**
   * v1.0.69: master switch para apagar todos los overlays loops + WS
   * uplink. Ahorra ~25-40MB de RAM. Las URLs siguen siendo válidas — al
   * reactivar, los Browser Sources se reconectan automáticamente.
   */
  'overlays.set-enabled': {
    params: { enabled: boolean };
    result: { ok: true; enabled: boolean; userId: string };
  };
}

export interface SettingsMethods {
  'settings.get': {
    params: Record<string, never>;
    result: { config: Record<string, unknown> };
  };
  'settings.set': {
    params: { patch: Record<string, unknown> };
    result: { ok: true };
  };
  'backups.list': {
    params: { scope?: BackupScope };
    result: { backups: BackupEntry[] };
  };
  'backups.create': {
    params: {
      scope: BackupScope;
      label?: string;
      reason?: BackupReason;
    };
    result: { backup: BackupEntry };
  };
  'backups.restore': {
    params: { id: string; autoPreBackup?: boolean };
    result: {
      ok: true;
      restoredScope: BackupScope;
      restoredId: string;
      preBackup: BackupEntry | null;
    };
  };
  'backups.delete': { params: { id: string }; result: { ok: true } };
  'backups.last': {
    params: { scope?: BackupScope };
    result: { backup: BackupEntry | null };
  };
}

export interface FortunesMethods {
  'fortunes.config.get': {
    params: Record<string, never>;
    result: { config: FortunesConfig };
  };
  'fortunes.config.set': {
    params: { patch: Partial<FortunesConfig> };
    result: { config: FortunesConfig };
  };
  'fortunes.list-categories': {
    params: Record<string, never>;
    result: {
      categories: { id: string; count: number; sample: string }[];
      introCount: number;
      total: number;
    };
  };
  'fortunes.read': {
    params: { name?: string };
    result: { text: string; intro: string; body: string; category?: string };
  };
  'fortunes.test': {
    params: { name?: string };
    result: { ok: boolean; text: string; error?: string };
  };
}

/** Boost externo de multiplicación de reglas — v1.0.54.
 *
 *  El user crea estos en el BoostsDialog (panel externo). Cada boost
 *  apunta a un grupo de reglas y un target (rol o usuario). Múltiples
 *  boosts pueden caer sobre la misma regla y el factor se ACUMULA
 *  multiplicativamente. */
export type RuleBoostKind =
  | 'super_fan'
  | 'mod'
  | 'follower'
  | 'member'
  | 'donor'
  | 'user';

export interface RuleBoostTarget {
  kind: RuleBoostKind;
  /** Solo aplica cuando kind in ['member', 'donor']. Rango 1..50 (member
   *  level y gifter level de TikTok). */
  level_min?: number;
  level_max?: number;
  /** Solo aplica cuando kind == 'user'. Username sin `@`, lowercase. */
  username?: string;
}

export interface RuleBoost {
  id: string;
  name: string;
  enabled: boolean;
  /** Multiplicador 1..100. Total acumulado de TODOS los boosts
   *  aplicables se topa también en 100 para evitar abusos. */
  factor: number;
  target: RuleBoostTarget;
  /** Lista de rule_ids a los que aplica. Si contiene "all" → aplica
   *  a TODAS las reglas. Si no, solo a las listadas. */
  rule_ids: string[];
}

/** Top Lives — histórico top 3 likes por sesión de live (v1.0.56). */
export interface TopLiveTopEntry {
  place: 1 | 2 | 3;
  user: string;
  taps: number;
  avatar?: string;
}

export interface TopLiveRecord {
  id: string;
  started_at: number;
  ended_at: number;
  duration_min: number;
  username: string;
  top: TopLiveTopEntry[];
}

export interface TopLiveCurrent {
  started_at: number;
  username: string;
  top: TopLiveTopEntry[];
  live: true;
}

export interface UserTopCounts {
  top1: number;
  top2: number;
  top3: number;
  total: number;
}

export interface TopLivesMethods {
  'top-lives.list': {
    params: Record<string, never>;
    result: {
      lives: TopLiveRecord[];
      current: TopLiveCurrent | null;
      userCounts: Record<string, UserTopCounts>;
      maxLives: number;
    };
  };
  'top-lives.user-counts': {
    params: { username: string };
    result: UserTopCounts;
  };
  'top-lives.force-snapshot': {
    params: Record<string, never>;
    result: { ok: boolean };
  };
  'top-lives.delete': {
    params: { id: string };
    result: { ok: boolean; removed: boolean };
  };
  'top-lives.set-max': {
    params: { max: number };
    result: { ok: boolean; max: number };
  };
  'top-lives.clear': {
    params: Record<string, never>;
    result: { ok: boolean };
  };
}

export interface BoostsMethods {
  /**
   * v1.0.70: los boosts ahora son POR JUEGO. Si el caller no pasa
   * `gameId`, el sidecar usa el juego activo de `config.json`. Para UI
   * con cambio de juego en vivo, SIEMPRE pasar el gameId explícito.
   */
  'boosts.list': {
    params: { gameId?: string };
    result: { boosts: RuleBoost[]; gameId: string };
  };
  'boosts.upsert': {
    params: { gameId?: string; boost: Partial<RuleBoost> };
    result: { ok: boolean; boost: RuleBoost; created: boolean; gameId: string };
  };
  'boosts.delete': {
    params: { gameId?: string; id: string };
    result: { ok: boolean; gameId: string };
  };
  'boosts.replace-all': {
    params: { gameId?: string; boosts: Partial<RuleBoost>[] };
    result: { ok: boolean; boosts: RuleBoost[]; gameId: string };
  };
}

export interface FortunesConfig {
  enabled: boolean;
  gift_id: string;
  voice: string;
  volume_pct: number;
  categories: string[];
}

export type RpcMethodMap = SystemMethods &
  TikTokMethods &
  RulesMethods &
  DataMethods &
  GamesMethods &
  SocialMethods &
  SpotifyMethods &
  IaMethods &
  TtsMethods &
  OverlaysMethods &
  ProfilesMethods &
  SettingsMethods &
  LogsMethods &
  MigrationsMethods &
  DonationsMethods &
  SoundsMethods &
  FortunesMethods &
  BoostsMethods &
  TopLivesMethods &
  EmotesMethods &
  KeyboardMethods;
