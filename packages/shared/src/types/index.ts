export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AppHealth {
  sidecar: ConnectionStatus;
  tiktok: ConnectionStatus;
  version: string;
}

export interface PingResult {
  ok: true;
  pongAt: number;
  protocolVersion: number;
  echo?: string;
}

/**
 * GameId — id arbitrario de un perfil de juego.
 *
 * Antes (F0-F8) era un union literal con 4 valores. MARU original
 * permite N perfiles custom con cualquier id `[a-zA-Z0-9_]{2,}`,
 * así que lo abrimos a `string` con la lista canónica de predefinidos
 * separada en `STANDARD_GAME_IDS`.
 */
export type GameId = string;

export const STANDARD_GAME_IDS = ['valheim', 'terraria', 'minecraft'] as const;
export type StandardGameId = (typeof STANDARD_GAME_IDS)[number];

export type GameConnectionType = 'http' | 'rcon';

export interface GameConnection {
  host: string;
  port: number;
  password?: string;
}

/**
 * Categoría declarativa de un juego custom.
 *
 * Cada categoría es una pestaña en el editor de datos (`DataDialog`)
 * y se mapea a un endpoint HTTP o un RCON command para la ejecución
 * de acciones desde reglas.
 *
 * Espejo de `core/games.py:CustomGame.categories[*]` (audit dialog 02).
 */
export interface GameCategory {
  /** Identidad estable: `entities`, `items`, `events`, `valuables`... */
  id: string;
  /** Nombre visible: "🐉 Entidades", "📦 Items"... */
  name: string;
  /** Tipo conceptual — usado por el rule engine. */
  type: 'entity' | 'item' | 'event' | 'valuable';
  /** Emoji para la pestaña. */
  icon: string;
  /** Key dentro del `data_<gid>.json` (típicamente igual a `id`). */
  dataKey: string;
  /** Endpoint HTTP relativo (ej `/spawn`) — vacío si modo RCON. */
  endpoint: string;
  /** Body template HTTP (`{entity}`, `{amount}`, `{user}`...). */
  payload: string;
  /** Comando RCON con templating (`summon {entity}`). */
  rconCmd: string;
  /** Texto que se muestra al abrir el editor de datos de esta cat. */
  tutorial: string;
}

/**
 * `GameProfile` — perfil completo de un juego (predefinido o custom).
 *
 * Réplica de la estructura del MARU original
 * (`gui/dialogs/manage_games_dialog.py` + `custom_game_dialog.py`).
 *
 * Para STANDARD games (`valheim`, `terraria`, `minecraft`) las
 * `categories` y endpoints/payloads son inmutables — el usuario solo
 * puede tocar `connection`, `tabNames` y (Minecraft) `password`.
 *
 * `basedOn` se setea cuando el perfil se creó duplicando otro
 * — útil para mantener trazabilidad.
 */
export interface GameProfile {
  id: GameId;
  name: string;
  icon: string;
  /** True para los 3 predefinidos del MARU. Inmutables en su estructura. */
  isStandard: boolean;
  connection: GameConnection;
  connectionType: GameConnectionType;
  /** Renombrar las pestañas fijas (solo standard). */
  tabNames?: {
    entities?: string;
    items?: string;
    events?: string;
    valuables?: string;
  };
  hasEntities: boolean;
  hasItems: boolean;
  hasEvents: boolean;
  hasValuables?: boolean;
  /** Solo custom: categorías declarativas. Para standard: vacío. */
  categories: GameCategory[];
  /** Compartir sonidos globales (vs. set propio del perfil). */
  shareSounds: boolean;
  /** Compartir voces globales (vs. set propio del perfil). */
  shareVoices: boolean;
  /** Id del perfil del que se duplicó al crearlo. */
  basedOn?: string;
}

/**
 * Triggers válidos en MARU original (`rule_dialog.py`).
 *
 * El union literal sirve para autocomplete pero el tipo expuesto es
 * `string` para tolerar futuros triggers que el sidecar pueda agregar
 * sin romper compilación del renderer.
 */
export const STANDARD_TRIGGER_TYPES = [
  'gift',
  'command',
  'follow',
  'share',
  'subscribe',
  'like',
  'like_milestone',
  'emote',
  'join',
] as const;
export type StandardTriggerType = (typeof STANDARD_TRIGGER_TYPES)[number];
export type RuleTriggerType = StandardTriggerType | string;

/**
 * Acción individual dentro de una `Rule` — schema verbose MARU
 * (`rule_dialog.py:get_rule -> actions`).
 *
 * `action_type` es el id de una `GameProfile.categories[*].id`
 * (`entity`, `item`, `event`, `valuable`, o cualquier custom de G4).
 *
 * `action_type_name` es el label visible cacheado para que la lista
 * en el dialog no tenga que hacer lookup contra `categories[]` cada
 * render.
 *
 * `commands` es texto multilínea para Minecraft / RCON; vacío para HTTP.
 */
export interface RuleAction {
  action_type: string;
  action_type_name: string;
  action_value: string;
  amount: number;
  commands: string;
}

/**
 * `Rule` — schema MARU verbose, fuente de verdad para el RuleEngine.
 *
 * Réplica exacta de `rule_dialog.py:get_rule()`. Los compat fields
 * (`action_type`, `action_value`, `amount`, `commands` planos) son
 * espejo de `actions[0]` y los mantiene sincronizados el sidecar.
 *
 * Convención snake_case para mantener paridad con el JSON en disco
 * y que el RuleEngine Python pueda leer sin re-mapear keys.
 */
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: RuleTriggerType;
  /** Para gift: id; like: cada N; milestone: meta; command: !cmd. */
  trigger_value: string;
  actions: RuleAction[];
  random_action: boolean;
  cooldown: number;
  tts_enabled: boolean;
  tts_message: string;
  tts_voice: string;
  /** Lista en lowercase. Vacía = todos permitidos. */
  allowed_users: string[];
  /** Lista de flags (`is_super_fan`, `is_moderator`, …). El user que dispara
   * la regla debe tener AL MENOS UNO. Vacía = sin restricción de rango. */
  required_ranks?: RankFlag[];
  /** Lista de flags. Si el user tiene ALGUNO, la regla NO dispara. */
  excluded_ranks?: RankFlag[];

  /** v1.0.49: multiplicador opcional de ejecuciones cuando el user del
   *  evento cumple un rol/nivel. Si no está o `enabled=false`, la regla
   *  ejecuta normalmente (×1). */
  repeat_for?: {
    enabled: boolean;
    rank: 'mod' | 'superfan' | 'donor' | 'follower' | 'member';
    level_min?: number;
    level_max?: number;
    times: number;
  };

  // Compat — espejo de actions[0]. El sidecar los mantiene actualizados.
  action_type?: string;
  action_value?: string;
  amount?: number;
  commands?: string;
}

/** Flags de rango (boolean) detectables en `tiktok:event.data` para filtrar
 * reglas. Espejo de `core_bridge.RANK_KEYS` (Python). */
export type RankFlag =
  | 'is_anchor'
  | 'is_moderator'
  | 'is_super_fan'
  | 'is_member'
  | 'is_top_gifter'
  | 'is_follower'
  | 'is_friend'
  | 'is_mutual_follow'
  | 'is_verified'
  | 'is_new_subscriber'
  | 'is_friends_badge'
  | 'is_first_recharge'
  | 'is_live_pro'
  | 'is_activity'
  | 'is_gift_giver';

/** Metadata humano-legible de cada flag — usada por el RuleDialog. */
export const RANK_FLAGS_META: { value: RankFlag; label: string; emoji: string }[] = [
  { value: 'is_anchor', label: 'Streamer (host del live)', emoji: '🎙️' },
  { value: 'is_moderator', label: 'Moderador', emoji: '🛡️' },
  { value: 'is_super_fan', label: 'Super fan / Suscriptor', emoji: '⭐' },
  { value: 'is_member', label: 'Miembro del fans club (cualquier nivel)', emoji: '🌸' },
  { value: 'is_top_gifter', label: 'Top gifter (ranking)', emoji: '🏆' },
  { value: 'is_follower', label: 'Te sigue', emoji: '➕' },
  { value: 'is_mutual_follow', label: 'Se siguen mutuamente', emoji: '🤝' },
  { value: 'is_friend', label: 'Amigo (you follow them)', emoji: '👥' },
  { value: 'is_verified', label: 'Verificado', emoji: '✓' },
  { value: 'is_new_subscriber', label: 'Nuevo suscriptor', emoji: '🆕' },
  { value: 'is_friends_badge', label: 'Badge "Friends"', emoji: '🫂' },
  { value: 'is_first_recharge', label: 'Primera recarga', emoji: '💰' },
  { value: 'is_live_pro', label: 'Live Pro', emoji: '🎬' },
  { value: 'is_activity', label: 'Badge de actividad', emoji: '🎯' },
  { value: 'is_gift_giver', label: 'Ya regaló antes', emoji: '🎁' },
];

/** Mapeo cat_id (GameProfile) → action_type legacy del RuleEngine. */
export const ACTION_TYPE_LEGACY_MAP: Record<string, string> = {
  entity: 'spawn',
  entities: 'spawn',
  item: 'give_item',
  items: 'give_item',
  event: 'trigger_event',
  events: 'trigger_event',
  valuable: 'spawn_valuable',
  valuables: 'spawn_valuable',
};

export interface TikTokEvent {
  type:
    | 'gift'
    | 'like'
    | 'like_milestone'
    | 'follow'
    | 'share'
    | 'comment'
    | 'join'
    | 'subscribe'
    | 'command';
  user: string;
  nickname?: string;
  avatar?: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface TikTokStats {
  viewers: number;
  likes: number;
  diamonds: number;
  followers: number;
  shares: number;
}

export interface SpotifyNowPlaying {
  isPlaying: boolean;
  track?: {
    name: string;
    artist: string;
    album?: string;
    durationMs: number;
    positionMs: number;
  };
  requestedBy?: string;
}

// ── Spotify extendido (G14) ─────────────────────────────────────────────

export interface SpotifyAccount {
  /** Identificador interno (user-chosen). */
  name: string;
  /** Display name de Spotify (cuando está logueado). */
  displayName: string;
  isCurrent: boolean;
  /** False si es la cuenta actualmente conectada pero NO está persistida
   * en spotify_accounts.json — UI muestra botón "💾 Guardar". */
  saved?: boolean;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volumePercent: number;
}

export interface SpotifyQueueItem {
  trackName: string;
  artist: string;
  requestedBy: string;
  isPriority: boolean;
  trackId: string;
}

export interface SpotifyStatus {
  connected: boolean;
  available: boolean;
  account?: { id?: string; name?: string } | null;
  rateLimited?: boolean;
}

export type SpotifyCommandId = 'play' | 'skip' | 'cola' | 'pause' | 'playfan';

export interface SpotifyConfig {
  enabled: boolean;
  /** 1-50 canciones máximo en la cola random. */
  max_queue: number;
  tts_enabled: boolean;
  device_id: string;
  enabled_commands: SpotifyCommandId[];
  /**
   * username (lower) → daily uses limit (0-50).
   *
   * Sincronizado AUTOMÁTICAMENTE desde el rol Super Fan del live de
   * TikTok. La UI no permite agregar/quitar manualmente; solo edita
   * los `uses/día` de los super fans actuales.
   */
  priority_users: Record<string, number>;
  /**
   * Default `uses/día` que se asigna a los super fans nuevos cuando
   * el sidecar los detecta automáticamente.
   */
  playfan_default_uses?: number;
}

/**
 * Super fan registrado del live (TikTok `is_super_fan` flag).
 * La membresía se sincroniza en tiempo real desde el sidecar.
 */
export interface SpotifySuperFan {
  username: string;
  displayName: string;
  /** Timestamp ms del PRIMER comment-enriched con `is_super_fan=True`. */
  firstSeenMs: number;
  /** Timestamp ms del comment-enriched más reciente. */
  lastSeenMs: number;
  /** `uses/día` configurado para este super fan (editable). */
  uses: number;
  /** !playfan que ya consumió HOY. Persistido en `spotify.json`. */
  usedToday: number;
  /** Atajo: max(0, uses - usedToday). El sidecar lo calcula y devuelve. */
  remaining: number;
}

// ── TTS (G9) ────────────────────────────────────────────────────────────

export type TtsChannel = 'chat' | 'social' | 'fortune';
export type TtsVoiceMode = 'global' | 'profile';

export interface TtsVoice {
  id: string;
  name: string;
  /** Familia para agrupamiento en la UI (popular, characters, asian, ...). */
  family: string;
}

export interface TtsConfig {
  enabled: boolean;
  enabled_chat: boolean;
  enabled_social: boolean;
  enabled_fortune: boolean;
  default_voice: string;
  voice_mode: TtsVoiceMode;
  /** 0-100 (UI). El sidecar convierte a 0-1.0 al aplicar al engine. */
  volume_chat: number;
  volume_social: number;
  volume_fortune: number;
}

export interface TtsUserVoice {
  /** Username normalizado (lower, sin @, sin espacios). */
  username: string;
  voice: string;
}

export interface TtsQueueSizes {
  chat: number;
  social: number;
  fortune: number;
}

export interface TtsTestResult {
  ok: boolean;
  voice?: string;
  text?: string;
  message?: string;
}

// ── IA (G8) ─────────────────────────────────────────────────────────────

export const IA_PROVIDER_IDS = ['claude', 'groq', 'gemini', 'openai'] as const;
export type IaProviderId = (typeof IA_PROVIDER_IDS)[number];

export interface IaProviderMeta {
  name: string;
  url: string;
  default_model: string;
  free: boolean;
  icon: string;
  help_url: string;
  help_text: string;
}

export interface IaModelOption {
  id: string;
  name: string;
}

export interface IaCostRate {
  /** USD por 1M tokens de input. */
  input: number;
  /** USD por 1M tokens de output. */
  output: number;
}

export interface IaConfig {
  enabled: boolean;
  provider: IaProviderId;
  /** Key del provider activo (también guardado en api_keys[provider]). */
  api_key: string;
  /** Keys per-provider — cambiar de provider preserva la del anterior. */
  api_keys: Partial<Record<IaProviderId, string>>;
  model: string;
  /** 100-800 caracteres (clampeado por sidecar). */
  max_response_length: number;
  /** 3-120 segundos. */
  cooldown_seconds: number;
  /** Custom system prompt (vacío = default). */
  system_prompt: string;
}

export interface IaProvidersMeta {
  providers: Record<IaProviderId, IaProviderMeta>;
  models: Record<IaProviderId, IaModelOption[]>;
  costRates: Record<string, IaCostRate>;
}

export interface IaAskMeta {
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  fortune_type?: string;
  [k: string]: unknown;
}

export interface IaTestResult {
  ok: boolean;
  answer: string;
  meta?: IaAskMeta;
  latencyMs: number;
}

// ── Social system (G7) ───────────────────────────────────────────────────

export interface SocialAutoRacha {
  active: boolean;
  total_days: number;
  remaining_days: number;
  started_at: string | number | null;
  /**
   * Tipo de racha automática:
   *  - "manual": el streamer la activó por N días.
   *  - "super_fan": vinculada al rol Super Fan del live (dura mientras
   *    el user mantenga is_super_fan=true). Renderer la pinta dorada.
   */
  kind?: 'manual' | 'super_fan';
}

export interface SocialUser {
  username: string;
  registered: boolean;
  racha: number;
  record_racha: number;
  auto_racha: SocialAutoRacha | null;
  marriage: string | null;
  partner: string | null;
  best_friend: string | null;
  rival: string | null;
  duelos_ganados: number;
  duelos_perdidos: number;
  registered_at: string | number | null;
  /** URL del avatar (CDN TikTok) — persistente. */
  avatar?: string | null;
  /** Si el user está marcado como Super Fan EN ESTE LIVE. */
  is_super_fan?: boolean;
}

export interface SocialConfig {
  enabled: boolean;
  require_register: boolean;
  cooldown_seconds: number;
  timeout_seconds: number;
  /** Volume 0-100 (UI). El sidecar lo persiste como recibe. */
  volume: number;
  voice: string;
  enabled_commands: string[];
}

export interface SocialStats {
  total_users: number;
  registered_users: number;
  total_duelos: number;
  total_interacciones: number;
  total_matrimonios: number;
  total_divorcios: number;
  total_noviazgos: number;
  total_rupturas: number;
  active_marriages: number;
  active_partnerships: number;
  active_friendships: number;
  active_rivalries: number;
  top_streak: { username: string; record: number } | null;
}

export interface SocialCommand {
  cmd: string;
  name: string;
  icon: string;
  desc?: string;
}

export interface SocialCategoryMeta {
  name: string;
  icon: string;
  desc: string;
  commands: SocialCommand[];
}

export type TapsPeriod = 'total' | 'semanal' | 'mensual';

export interface TapsRankingEntry {
  username: string;
  taps: number;
  lastActive: string | number | null;
}

export type RelationshipType = 'novios' | 'amigo' | 'rival';

export type BackupScope = 'rules' | 'data' | 'social' | 'config' | 'full';

/**
 * Razón canónica del backup. Paridad MARU `_REASON_MAP` del
 * `backup_dialog.py` + 'auto' que el sidecar usa para pre-edits internos.
 *
 * Cualquier string fuera de las conocidas es válido (cae al fallback
 * gris en la UI).
 */
export type BackupReason =
  | 'manual'
  | 'pre_load'
  | 'prerestore'
  | 'pre_import'
  | 'auto'
  | string;

export interface BackupEntry {
  id: string;
  createdAt: number;
  sizeBytes: number;
  scope: BackupScope;
  label?: string | null;
  reason?: BackupReason;
  filesCount?: number;
  sha256?: string;
}

export interface OverlayInfo {
  id: string;
  /** @deprecated usar `name` */
  title?: string;
  name: string;
  icon: string;
  description: string;
  url: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Placeholder visual "próximamente" — sin URL ni RPC funcional. */
  placeholder?: boolean;
}

/**
 * Categorías estándar — los juegos predefinidos siempre usan estas keys.
 *
 * Para CustomGame, el `kind` puede ser cualquier id declarado en
 * `GameProfile.categories[*].id`. Por eso el tipo es `string`, no
 * union literal. `STANDARD_DATA_KINDS` queda como guía.
 */
export const STANDARD_DATA_KINDS = [
  'entities',
  'items',
  'events',
  'valuables',
] as const;
export type StandardDataKind = (typeof STANDARD_DATA_KINDS)[number];
export type DataKind = StandardDataKind | string;

export interface DataEntry {
  /** Display: "Troll Furioso" */
  name: string;
  /** Comando interno: "Troll" */
  command: string;
  /**
   * Path relativo al bundle de imágenes (`game/<gid>/<cat>/<file>.png`).
   * Resuelto por el sidecar — el renderer lo pasa a `<MaruImage scope="game">`.
   */
  imagePath?: string;
  /** Tags / notas opcionales. */
  meta?: Record<string, string>;
}

/**
 * Categoría enriquecida con sus entries — usado por
 * `EntitySelectorDialog` con tabs por categoría.
 */
export interface DataCategoryBundle {
  label: string;
  entries: DataEntry[];
}

export interface ProfileSnapshot {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Hash SHA-256 del contenido para detectar drift */
  sha256: string;
  /** Juego activo del snapshot — null si no se pudo inferir. */
  gameId?: string | null;
  gameName?: string | null;
  rulesCount?: number;
  rulesEnabled?: number;
  giftsCount?: number;
  customGamesCount?: number;
  /** Tamaño total del snapshot en bytes. */
  sizeBytes?: number;
}

// ── Sounds (G10) ────────────────────────────────────────────────────────

export type SoundEvent = 'follow' | 'share' | 'superfan';

export interface SoundLibraryItem {
  path: string;
  name: string;
  sizeBytes: number;
  exists: boolean;
}

export interface SoundsConfig {
  scope: string;
  library: SoundLibraryItem[];
  /** `{ giftId: path }` — vacío string '' = sin sonido. */
  gifts: Record<string, string>;
  /** Sonidos por evento (3 fijos). */
  events: Record<SoundEvent, string>;
  /** Volumen 0-100. */
  volume: number;
}

// ── Logs (G11) ──────────────────────────────────────────────────────────

export const LOG_CATEGORIES = [
  'system',
  'tiktok',
  'gift',
  'follow',
  'share',
  'like',
  'subscribe',
  'comment',
  'command',
  'emote',
  'rule',
  'action',
  'social',
  'music',
  'ia',
  'tts',
  'sound',
  'profile',
  'fortune',
  'join',
  'error',
  'warn',
  'debug',
] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'WARN' | 'ERROR' | 'CRITICAL';

/**
 * Grupos visuales para los filter pills — granular, 1 grupo por tipo de
 * evento. El sidecar emite categorías y la UI mapea 1:1 (con 2 excepciones:
 * chat = comment+command, audio = music+tts+sound, errores = error+warn).
 *
 * Diseño: el user pidió expandir los filtros para que regalos, follows,
 * likes, etc. tengan SU PROPIO toggle separado en vez de venir agrupados
 * en "eventos".
 */
export type LogGroup =
  | 'comments' // comment (chat libre)
  | 'commands' // command (! prefix) — separado de comments
  | 'gifts' // gift entrante
  | 'emotes' // emotes/stickers del live
  | 'follows' // nuevos seguidores
  | 'likes' // likes contados
  | 'shares' // compartidos del live
  | 'subs' // subscribers del live
  | 'rules' // reglas matched + acciones ejecutadas en el juego
  | 'social' // sistema social interno (duelos, rachas, ranking)
  | 'music' // spotify (play, skip, cola)
  | 'ia' // respuestas/queries IA
  | 'fortune' // fortuna leída al user (texto + TTS)
  | 'joins' // joins al live (entradas)
  | 'audio' // tts + sonidos
  | 'sistema' // system / tiktok-conexión / profile
  | 'errores'; // error + warn

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  source: string;
  category: LogCategory;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogStats {
  byCategory: Record<LogCategory, number>;
  total: number;
  bufferSize: number;
  bufferMax: number;
}

export interface SystemHealthIndicator {
  id: 'sidecar' | 'tiktok' | 'game' | 'tts';
  label: string;
  status: 'connected' | 'disconnected' | 'error' | 'idle';
  detail?: string;
}
