import { useState, type DragEvent } from 'react';
import { Edit3, ImagePlus, Loader2, Package, Trash2 } from 'lucide-react';
import type { GameId, GameProfile } from '@maru/shared';
import { Button } from '@maru/ui';
import { HealthBadge } from './HealthBadge.js';

/**
 * `GameCard` — card visual de un juego en la galería del ManageGamesDialog
 * (v1.0.72; drag-drop + botón rápido en v1.0.75).
 *
 * Estilo Steam Library: portada vertical 600x900 grande arriba, nombre + meta
 * abajo, acciones flotantes en hover.
 *
 * Estados visuales:
 *   - Si `coverImage` está → pinta `maru://images/game_covers/<file>`.
 *   - Si NO → fallback con gradient único por juego + emoji grande encima.
 *   - Si `requiresMod` → badge "⚠️ Requiere mod" en esquina superior.
 *   - Si está conectado/saludable → HealthBadge en esquina inferior izq.
 *
 * UX para cambiar portada (v1.0.75):
 *   - **Drag-drop**: arrastrá una imagen del explorador sobre la card →
 *     overlay "Soltá para cambiar portada" → suelta → cambio instantáneo.
 *   - **Botón "📷"**: visible al hover, click → file picker → cambio.
 *   - Ambos métodos llaman a `onChangeCover(file_path)` que sube + persiste.
 */

export interface GameCardProps {
  profile: GameProfile;
  onEdit: () => void;
  onOpenData: () => void;
  /** undefined si no se puede borrar (predefinidos). */
  onDelete?: () => void;
  /** Estilo Steam: la card es clicable y abre el editor por default. */
  onClick?: () => void;
  /**
   * v1.0.75: callback cuando el user quiere cambiar la portada.
   * Recibe el path absoluto del archivo (drag-drop o file picker).
   * El parent llama a `useGames().setCover(id, path)`.
   */
  onChangeCover?: (gameId: GameId, sourcePath: string) => Promise<void> | void;
  /** v1.0.75: callback para quitar la portada custom. */
  onRemoveCover?: (gameId: GameId) => Promise<void> | void;
}

/** Gradient determinístico desde el id del juego — visualmente único pero
 *  reproducible. Si el juego no tiene cover, este gradient es el fondo. */
function gradientFor(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = (h ^ id.charCodeAt(i)) * 16777619;
    h = h >>> 0;
  }
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 65% 28%), hsl(${hue2} 70% 18%))`;
}

const ACCEPTED_EXTS = /\.(png|jpe?g|webp)$/i;

export function GameCard({
  profile,
  onEdit,
  onOpenData,
  onDelete,
  onClick,
  onChangeCover,
  onRemoveCover,
}: GameCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [coverBust, setCoverBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadFlash, setUploadFlash] = useState<'ok' | 'err' | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const coverUrl = profile.coverImage
    ? `maru://images/game_covers/${profile.coverImage}?v=${coverBust}`
    : null;
  const showImage = coverUrl && !imgFailed;
  const requiresMod = !!profile.requiresMod;

  /** Llama al callback con el sourcePath y muestra feedback visual. */
  async function applyCover(sourcePath: string) {
    if (!onChangeCover || uploading) return;
    setUploading(true);
    setUploadFlash(null);
    try {
      await onChangeCover(profile.id, sourcePath);
      setImgFailed(false);
      setCoverBust((b) => b + 1);
      setUploadFlash('ok');
      window.setTimeout(() => setUploadFlash(null), 1500);
    } catch {
      setUploadFlash('err');
      window.setTimeout(() => setUploadFlash(null), 2500);
    } finally {
      setUploading(false);
    }
  }

  /** Click en "📷 Cambiar" → file picker nativo. */
  async function handleChangeClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onChangeCover || uploading) return;
    const picked = await window.maruApi.dialog.openFile({
      title: `Cambiar portada de ${profile.name}`,
      filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (!picked.ok || !picked.path) return;
    await applyCover(picked.path);
  }

  async function handleRemoveClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onRemoveCover || uploading) return;
    setUploading(true);
    try {
      await onRemoveCover(profile.id);
      setImgFailed(false);
      setCoverBust((b) => b + 1);
      setUploadFlash('ok');
      window.setTimeout(() => setUploadFlash(null), 1500);
    } catch {
      setUploadFlash('err');
      window.setTimeout(() => setUploadFlash(null), 2500);
    } finally {
      setUploading(false);
    }
  }

  // ── Drag & drop handlers ─────────────────────────────────────────
  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!onChangeCover) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) setDragActive(true);
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!onChangeCover) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!onChangeCover) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!ACCEPTED_EXTS.test(file.name)) {
      setUploadFlash('err');
      window.setTimeout(() => setUploadFlash(null), 2500);
      return;
    }
    // En Electron 32+ usamos webUtils para path absoluto del File.
    const path = window.maruApi.getPathForFile(file);
    if (!path) {
      setUploadFlash('err');
      window.setTimeout(() => setUploadFlash(null), 2500);
      return;
    }
    await applyCover(path);
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative flex flex-col rounded-xl border bg-bg-elev/40 overflow-hidden transition-all hover:shadow-lg hover:shadow-accent/10 hover:-translate-y-0.5 ${
        dragActive
          ? 'border-accent ring-2 ring-accent/60 scale-[1.02]'
          : 'border-border/60 hover:border-accent/60'
      }`}
    >
      {/* Cover area — aspect ratio 2:3 (Steam library style) */}
      <button
        type="button"
        onClick={onClick ?? onEdit}
        className="relative aspect-[2/3] w-full overflow-hidden cursor-pointer"
        title={profile.isStandard ? 'Configurar conexión' : 'Editar perfil'}
        style={!showImage ? { background: gradientFor(profile.id) } : undefined}
      >
        {showImage ? (
          <img
            src={coverUrl}
            alt={profile.name}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-emoji text-7xl drop-shadow-lg">{profile.icon}</span>
          </div>
        )}

        {/* Overlay top-right: badge si requiere mod */}
        {requiresMod && (
          <div className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-md bg-warning/90 text-warning-fg text-[10px] font-semibold backdrop-blur-sm">
            ⚠️ Requiere mod
          </div>
        )}
        {/* Overlay top-left: badge predefinido */}
        {profile.isStandard && (
          <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-success/85 text-success-fg text-[10px] font-semibold backdrop-blur-sm">
            ✓ Oficial
          </div>
        )}
        {/* Overlay bottom-left: health badge si tiene state */}
        <div className="absolute bottom-1.5 left-1.5">
          <HealthBadge gameId={profile.id} />
        </div>
        {/* Sutil oscurecimiento en hover para destacar acciones */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors pointer-events-none" />

        {/* v1.0.75: overlay de drag-drop activo */}
        {dragActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-accent/30 backdrop-blur-sm border-2 border-dashed border-accent">
            <div className="text-center px-3 py-2 rounded-lg bg-bg-base/80">
              <ImagePlus className="h-7 w-7 mx-auto text-accent mb-1" />
              <p className="text-xs font-bold text-accent">
                Soltá para cambiar portada
              </p>
            </div>
          </div>
        )}

        {/* v1.0.75: overlay de uploading */}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-base/70 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
          </div>
        )}

        {/* v1.0.75: flash de feedback (ok/err) */}
        {uploadFlash === 'ok' && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit px-3 py-1.5 rounded-md bg-success/90 text-success-fg text-xs font-bold animate-pulse">
            ✅ Portada actualizada
          </div>
        )}
        {uploadFlash === 'err' && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-auto w-fit px-3 py-1.5 rounded-md bg-danger/90 text-danger-fg text-xs font-bold">
            ❌ Error
          </div>
        )}
      </button>

      {/* Footer: nombre + meta + acciones */}
      <div className="p-2.5 space-y-1.5 bg-bg-base/40 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 min-w-0">
          {!showImage && (
            <span className="font-emoji text-base flex-none">{profile.icon}</span>
          )}
          <h4 className="text-sm font-semibold truncate flex-1" title={profile.name}>
            {profile.name}
          </h4>
        </div>
        <p className="text-[10px] text-fg-subtle font-mono truncate" title={`${profile.connectionType.toUpperCase()} · ${profile.connection.host}:${profile.connection.port}`}>
          {profile.connectionType.toUpperCase()} · {profile.connection.host}:{profile.connection.port}
        </p>
        {/* Acciones — visible solo en hover para no saturar la galería */}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenData}
            title="Editar entidades / items / eventos"
            className="flex-1 justify-center"
          >
            <Package className="h-3 w-3" />
            Datos
          </Button>
          {/* v1.0.75: botón directo "Cambiar portada" sin abrir editor */}
          {onChangeCover && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => void handleChangeClick(e)}
              title="Cambiar portada (también podés arrastrar la imagen sobre la card)"
              disabled={uploading}
            >
              <ImagePlus className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            title={profile.isStandard ? 'Configurar conexión' : 'Editar perfil'}
            className="flex-1 justify-center"
          >
            <Edit3 className="h-3 w-3" />
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              title="Eliminar perfil"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
