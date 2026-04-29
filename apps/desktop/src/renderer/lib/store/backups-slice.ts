import type { StateCreator } from 'zustand';
import type { BackupEntry, BackupScope } from '@maru/shared';

export interface BackupsSlice {
  backups: BackupEntry[];
  backupsStatus: 'idle' | 'loading' | 'ready' | 'error';
  backupsError: string | null;
  backupsScopeFilter: BackupScope | 'all';
  selectedBackupId: string | null;
  lastBackup: BackupEntry | null;

  setBackups: (list: BackupEntry[]) => void;
  setBackupsStatus: (s: BackupsSlice['backupsStatus']) => void;
  setBackupsError: (e: string | null) => void;
  setBackupsScopeFilter: (s: BackupScope | 'all') => void;
  setSelectedBackupId: (id: string | null) => void;
  setLastBackup: (b: BackupEntry | null) => void;
  upsertBackupLocal: (b: BackupEntry) => void;
  removeBackupLocal: (id: string) => void;
}

export const createBackupsSlice: StateCreator<
  BackupsSlice,
  [],
  [],
  BackupsSlice
> = (set) => ({
  backups: [],
  backupsStatus: 'idle',
  backupsError: null,
  backupsScopeFilter: 'all',
  selectedBackupId: null,
  lastBackup: null,

  setBackups: (list) =>
    set({ backups: list, backupsStatus: 'ready', backupsError: null }),
  setBackupsStatus: (backupsStatus) => set({ backupsStatus }),
  setBackupsError: (backupsError) =>
    set({ backupsError, backupsStatus: backupsError ? 'error' : 'ready' }),
  setBackupsScopeFilter: (backupsScopeFilter) => set({ backupsScopeFilter }),
  setSelectedBackupId: (selectedBackupId) => set({ selectedBackupId }),
  setLastBackup: (lastBackup) => set({ lastBackup }),
  upsertBackupLocal: (b) =>
    set((s) => {
      const idx = s.backups.findIndex((x) => x.id === b.id);
      const next =
        idx === -1 ? [...s.backups, b] : s.backups.map((x, i) => (i === idx ? b : x));
      return { backups: next };
    }),
  removeBackupLocal: (id) =>
    set((s) => ({
      backups: s.backups.filter((b) => b.id !== id),
      selectedBackupId: s.selectedBackupId === id ? null : s.selectedBackupId,
    })),
});
