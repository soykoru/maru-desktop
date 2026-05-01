import { create } from 'zustand';
import { createBackupsSlice, type BackupsSlice } from './backups-slice.js';
import { createConnectionSlice, type ConnectionSlice } from './connection-slice.js';
import { createDataSlice, type DataSlice } from './data-slice.js';
import { createGamesSlice, type GamesSlice } from './games-slice.js';
import { createGiftsSlice, type GiftsSlice } from './gifts-slice.js';
import { createIaSlice, type IaSlice } from './ia-slice.js';
import { createLogSlice, type LogSlice } from './log-slice.js';
import { createProfilesSlice, type ProfilesSlice } from './profiles-slice.js';
import { createRulesSlice, type RulesSlice } from './rules-slice.js';
import { createSocialSlice, type SocialSlice } from './social-slice.js';
import { createSoundsSlice, type SoundsSlice } from './sounds-slice.js';
import { createSpotifySlice, type SpotifySlice } from './spotify-slice.js';
import { createTikTokSlice, type TikTokSlice } from './tiktok-slice.js';
import { createTtsSlice, type TtsSlice } from './tts-slice.js';
import { createUiSlice, type UiSlice } from './ui-slice.js';
import { createUpdaterSlice, type UpdaterSlice } from './updater-slice.js';

export type AppStore = ConnectionSlice &
  TikTokSlice &
  UiSlice &
  UpdaterSlice &
  GiftsSlice &
  GamesSlice &
  DataSlice &
  RulesSlice &
  SocialSlice &
  IaSlice &
  TtsSlice &
  ProfilesSlice &
  SoundsSlice &
  LogSlice &
  BackupsSlice &
  SpotifySlice;

export const useAppStore = create<AppStore>()((...a) => ({
  ...createConnectionSlice(...a),
  ...createTikTokSlice(...a),
  ...createUiSlice(...a),
  ...createUpdaterSlice(...a),
  ...createGiftsSlice(...a),
  ...createGamesSlice(...a),
  ...createDataSlice(...a),
  ...createRulesSlice(...a),
  ...createSocialSlice(...a),
  ...createIaSlice(...a),
  ...createTtsSlice(...a),
  ...createProfilesSlice(...a),
  ...createSoundsSlice(...a),
  ...createLogSlice(...a),
  ...createBackupsSlice(...a),
  ...createSpotifySlice(...a),
}));
