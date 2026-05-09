import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  ListChecks,
  Play,
  Plus,
  Power,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button, Empty, Input, Select, Spinner, toast } from '@maru/ui';
import type { GameId, GameProfile } from '@maru/shared';
import { useAppStore } from '../../lib/store/index.js';
import { useRules } from '../../lib/use-rules.js';
import { useGifts } from '../../lib/use-gifts.js';
import { rpcCall } from '../../lib/rpc.js';
import { useConfirm } from '../../lib/use-notify.js';
import { RuleListItem, type RuleDensity } from '../dialogs/rules/RuleListItem.js';
import {
  TRIGGER_KEYS,
  triggerMeta,
} from '../dialogs/rules/trigger-meta.js';

/**
 * `RulesTab` — pestaña 📋 Reglas (paridad MARU `_build_rules_tab`).
 *
 * Header: search + filter por trigger + botón Nueva.
 * Lista: cards con switch enable/disable + acciones (test/edit/dup/del).
 * Footer: import/export + count.
 */
export interface RulesTabProps {
  gameId: GameId | null;
  profile: GameProfile | null;
}

export function RulesTab({ gameId, profile }: RulesTabProps) {
  const openModal = useAppStore((s) => s.openModal);

  const {
    visibleRules,
    allRules,
    status,
    error,
    search,
    triggerFilter,
    selectedRuleId,
    setSearch,
    setTriggerFilter,
    setSelectedRuleId,
    refresh,
    remove,
    toggle,
    duplicate,
    test,
    upsert,
    reorder,
  } = useRules(gameId, { autoLoad: !!gameId });

  // ── Drag & drop reorder (paridad MARU original DragDropMode.InternalMove)
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function handleDragStart(id: string, e: React.DragEvent) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      /* algunos browsers no aceptan strings vacíos */
    }
  }
  function handleDragOver(id: string, e: React.DragEvent) {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetId !== id) setDropTargetId(id);
  }
  function handleDrop(targetId: string, e: React.DragEvent) {
    e.preventDefault();
    const src = draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!src || src === targetId) return;
    // Reordenar localmente y persistir.
    const ids = allRules.map((r) => r.id);
    const from = ids.indexOf(src);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, src);
    void reorder(ids).catch(() => undefined);
  }
  function handleDragEnd() {
    setDraggingId(null);
    setDropTargetId(null);
  }

  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  // Densidad de cards de regla — persistida en settings.json `rulesDensity`.
  // Toggle ciclea compact → normal → large → compact. Inicializa con
  // `normal` y se actualiza cuando llega la config del sidecar.
  const [density, setDensity] = useState<RuleDensity>('normal');
  // v1.1.4: layout SEPARADO de density. Botones independientes para que
  // el user pueda combinar (ej. "cuadrícula con cards normales" o
  // "lista con cards compactas"). Persistido en `rulesLayout`.
  const [layout, setLayout] = useState<'list' | 'grid'>('list');

  useEffect(() => {
    let cancelled = false;
    void rpcCall('settings.get', {})
      .then((r) => {
        if (cancelled) return;
        const cfg = (r as { config?: Record<string, unknown> }).config || {};
        const v = cfg['rulesDensity'];
        if (v === 'compact' || v === 'normal' || v === 'large') {
          setDensity(v);
        }
        const lay = cfg['rulesLayout'];
        if (lay === 'list' || lay === 'grid') {
          setLayout(lay);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  function cycleDensity() {
    const next: RuleDensity =
      density === 'compact' ? 'normal'
      : density === 'normal' ? 'large'
      : 'compact';
    setDensity(next);
    void rpcCall('settings.set', { patch: { rulesDensity: next } }).catch(() => undefined);
  }
  function toggleLayout() {
    const next: 'list' | 'grid' = layout === 'list' ? 'grid' : 'list';
    setLayout(next);
    void rpcCall('settings.set', { patch: { rulesLayout: next } }).catch(() => undefined);
  }
  const densityIcon =
    density === 'compact' ? '▤'
    : density === 'normal' ? '▦'
    : '▥';
  const densityLabel =
    density === 'compact' ? 'Compacto'
    : density === 'normal' ? 'Normal'
    : 'Grande';
  const layoutIcon = layout === 'grid' ? '⊞' : '☰';
  const layoutLabel = layout === 'grid' ? 'Cuadrícula' : 'Lista';

  // v1.0.95+: testTrace fue removido — ahora "Probar" emite un toast
  // ("Comando enviado, ver log") y el resultado real del RCON aparece
  // en el panel de Log (vía `_logs.publish` en `execute_rule_now` desde
  // v1.0.94). El testTrace inline mentía: decía "✓ Ejecutada" aunque
  // el RCON fallara después porque `MinecraftGame.execute_commands` es
  // fire-and-forget (devuelve True inmediato sin esperar respuesta del
  // server). El log SÍ refleja el resultado real.
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [validation, setValidation] = useState<{
    problems: Array<{ rule_name?: string; message: string; suggestion?: string | null; type: string }>;
    conflicts: Array<{ message: string }>;
    totalRules: number;
    info_count: number;
    warning_count: number;
    error_count: number;
  } | null>(null);

  const triggerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of allRules) {
      counts[r.trigger_type] = (counts[r.trigger_type] ?? 0) + 1;
    }
    return counts;
  }, [allRules]);

  // Mapa gift_id → iconPath para resolver imagen de donación de cada regla.
  // Las reglas guardan `trigger_value` con casing variable ("rose", "white rose",
  // "TikTok") y los gifts.json keys también ("Rose", "White Rose", "TikTok").
  // Normalizamos ambos a lowercase + trimmed para garantizar match.
  const { allGifts } = useGifts({ autoLoad: true });
  const giftIcons = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of allGifts) {
      if (!g.iconPath) continue;
      m.set(g.id, g.iconPath);
      const norm = g.id.toLowerCase().trim();
      if (!m.has(norm)) m.set(norm, g.iconPath);
      if (g.name) {
        const nameNorm = g.name.toLowerCase().trim();
        if (!m.has(nameNorm)) m.set(nameNorm, g.iconPath);
      }
    }
    return m;
  }, [allGifts]);
  // Costo en diamantes — para mostrar al lado de la donación.
  const giftCoins = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of allGifts) {
      if (!g.coins) continue;
      m.set(g.id, g.coins);
      const norm = g.id.toLowerCase().trim();
      if (!m.has(norm)) m.set(norm, g.coins);
      if (g.name) {
        const nameNorm = g.name.toLowerCase().trim();
        if (!m.has(nameNorm)) m.set(nameNorm, g.coins);
      }
    }
    return m;
  }, [allGifts]);

  // Mapa "<folder>::<displayName>" + "<displayName>" → command, cargado del
  // sidecar via `data.all-categories`. Permite resolver `🐗 Jabalí` → `Boar`
  // para mostrar la imagen real `game_images/<gid>/entities/Boar.png`.
  const [nameToCommand, setNameToCommand] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!gameId) {
      setNameToCommand(new Map());
      return;
    }
    let aborted = false;
    void rpcCall('data.all-categories', { gameId })
      .then((res) => {
        if (aborted) return;
        const m = new Map<string, string>();
        const cats = (res as { categories: Record<string, { entries: Array<{ name: string; command: string }> }> }).categories || {};
        for (const [folder, cat] of Object.entries(cats)) {
          for (const e of cat.entries || []) {
            if (!e || !e.name || !e.command) continue;
            m.set(`${folder}::${e.name}`, e.command);
            // También guardar sin folder (último gana, suficiente para
            // 95% de los casos en juegos standard).
            if (!m.has(e.name)) m.set(e.name, e.command);
          }
        }
        setNameToCommand(m);
      })
      .catch(() => undefined);
    return () => {
      aborted = true;
    };
  }, [gameId]);

  function openNewRule() {
    if (!gameId) return;
    openModal('rule', { gameId, ruleId: null });
  }

  function openEditRule(id: string) {
    if (!gameId) return;
    openModal('rule', { gameId, ruleId: id });
  }

  // Click-to-change rápido en la imagen de DONACIÓN de la regla.
  // Paridad con `_quick_change_gift` del MARU original: abre el gift-selector
  // y al elegir uno hace upsert sin abrir el RuleDialog completo.
  function handleQuickChangeGift(ruleId: string) {
    if (!gameId) return;
    const rule = allRules.find((r) => r.id === ruleId);
    if (!rule) return;
    if (rule.trigger_type !== 'gift') {
      // Si el trigger no es gift, abrir el editor completo en su lugar.
      openEditRule(ruleId);
      return;
    }
    openModal('gift-selector', {
      initialId: rule.trigger_value,
      title: '🎁 Cambiar donación',
      onSelect: (gift: { id: string; name?: string }) => {
        const updated = { ...rule, trigger_value: gift.id };
        void upsert(updated as never);
      },
    });
  }

  // Click en imagen de ACCIÓN abre la galería en MULTI-select. Las
  // selecciones REEMPLAZAN COMPLETAMENTE las acciones existentes (no se
  // suman). Si el usuario solo quiere una, marca una y listo. Si quiere
  // varias, marca varias.
  function handleQuickChangeAction(ruleId: string, actionIndex: number) {
    if (!gameId) return;
    const rule = allRules.find((r) => r.id === ruleId);
    if (!rule || !rule.actions[actionIndex]) return;
    const current = rule.actions[actionIndex];
    const cats = profile?.categories ?? [];
    openModal('entity-selector', {
      gameId,
      initialCategory: current.action_type,
      preselected: current.action_value,
      multiSelect: true,
      title: '🎯 Cambiar acciones de la regla',
      onConfirmMulti: (
        selections: Array<{
          category: string;
          catLabel?: string;
          displayName: string;
          amount: number;
        }>,
      ) => {
        if (selections.length === 0) return;
        const next = selections.map((s) => {
          const cat = cats.find((c) => c.id === s.category);
          return {
            action_type: s.category,
            action_type_name: s.catLabel || cat?.name || s.category,
            action_value: s.displayName,
            amount: s.amount,
            commands: '',
          };
        });
        // REEMPLAZAR todas las acciones (no se suman, no quedan las viejas).
        void upsert({ ...rule, actions: next } as never);
      },
    });
  }

  /** v1.0.95+: el confirm inline (ventanita en bottom-right) fue
   *  reemplazado por `useConfirm()` global del design system. El dialog
   *  aparece centrado, no se sobrepone con otros, respeta el tema dark. */
  async function handleDelete(id: string) {
    const rule = allRules.find((r) => r.id === id);
    if (!rule) return;
    const ok = await confirm({
      icon: '🗑️',
      title: `Eliminar "${rule.name}"`,
      message: '¿Eliminar esta regla?',
      footnote: 'Esta acción no se puede deshacer. La regla se quita del catálogo del juego.',
      variant: 'danger',
      confirmLabel: 'Eliminar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await remove(id);
      toast.success('Regla eliminada', rule.name);
    } catch (ex) {
      toast.error(
        'No se pudo eliminar',
        ex instanceof Error ? ex.message : String(ex),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(id: string) {
    setBusy(true);
    try {
      await duplicate(id);
    } finally {
      setBusy(false);
    }
  }

  async function handleValidateAll() {
    if (!gameId) return;
    setBusy(true);
    try {
      const res = await rpcCall('rules.validate-all', { gameId });
      setValidation(res as never);
    } finally {
      setBusy(false);
    }
  }

  /** v1.0.96+: "Probar" SIN toast. El user pidió quitar la ventanita —
   *  el panel de Log ya muestra TODO el resultado:
   *    - Si OK: "✅ {regla} ({action}) → {message} [PROBAR]" (verde)
   *    - Si fallo síncrono (regla/perfil/juego no existe): "❌ ... [PROBAR]" (rojo)
   *    - Si fallo del RCON async: el `[Minecraft RCON] FAIL ...` del logger
   *      del juego también llega al panel
   *  Backend `execute_rule_now` v1.0.96 publica al log también los errores
   *  tempranos (engine caído, regla inexistente, etc.) que antes pasaban
   *  silenciosos.
   *
   *  Excepción de network (sidecar caído / desconectado): tampoco se
   *  toastea — si el sidecar está down hay otros indicadores en la UI.
   */
  async function handleTest(id: string) {
    setBusy(true);
    try {
      await test(id);
      // No toast. El log dice el resultado.
    } catch (ex) {
      // Excepción de RPC (no es error del backend, sino del transport).
      // Lo tiramos a console para diagnóstico — el log del panel viene
      // del sidecar y si éste está caído no hay log.
      console.warn('[rules.test] RPC failure:', ex);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!gameId) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setImportStatus(null);
      try {
        const txt = await file.text();
        const parsed = JSON.parse(txt) as unknown;
        let arr: unknown[];
        if (Array.isArray(parsed)) {
          arr = parsed;
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { rules?: unknown }).rules)
        ) {
          arr = (parsed as { rules: unknown[] }).rules;
        } else {
          throw new Error('JSON debe contener array de reglas o {rules:[...]}');
        }
        let ok = 0;
        let fail = 0;
        for (const r of arr) {
          try {
            await upsert(r as never);
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        setImportStatus(
          `✓ ${ok} importadas${fail > 0 ? ` · ✗ ${fail} fallidas` : ''}`,
        );
        await refresh();
      } catch (ex) {
        setImportStatus(
          `✗ ${ex instanceof Error ? ex.message : String(ex)}`,
        );
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }

  function handleExport() {
    if (!gameId) return;
    const blob = new Blob(
      [JSON.stringify({ rules: allRules }, null, 2)],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${gameId}_rules.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border bg-bg-elev/30">
        <Input
          prefix={<Search className="h-3.5 w-3.5" />}
          placeholder="Buscar regla..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
          disabled={!gameId}
        />
        <Select
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value as never)}
          aria-label="Filtrar por trigger"
          className="w-[180px]"
          disabled={!gameId}
        >
          <option value="all">Todos los triggers</option>
          {TRIGGER_KEYS.map((t) => {
            const m = triggerMeta(t);
            return (
              <option key={t} value={t}>
                {m.emoji} {m.label} ({triggerCounts[t] ?? 0})
              </option>
            );
          })}
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleDensity}
          title={`Tamaño: ${densityLabel}. Click para ciclar (Compacto → Normal → Grande). Persiste entre sesiones.`}
        >
          <span className="text-base leading-none">{densityIcon}</span>
          {densityLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLayout}
          title={`Disposición: ${layoutLabel}. Click para alternar entre Lista y Cuadrícula. Persiste entre sesiones.`}
        >
          <span className="text-base leading-none">{layoutIcon}</span>
          {layoutLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openModal('boosts')}
          title="Multiplicadores acumulables: x2/x3/x4 a las reglas según el rol o el usuario que las dispare"
        >
          🚀
          Boosts
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={openNewRule}
          disabled={!gameId}
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva
        </Button>
      </div>

      {/* Sub-toolbar fija para regla seleccionada (paridad MARU
          `_build_rules_tab` toolbar L913-924). Acciones siempre visibles. */}
      <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-border bg-bg-elev/15 text-xs">
        <span className="text-fg-subtle shrink-0">
          {selectedRuleId
            ? `Seleccionada: ${
                allRules.find((r) => r.id === selectedRuleId)?.name ?? '?'
              }`
            : 'Sin regla seleccionada'}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectedRuleId && openEditRule(selectedRuleId)}
          disabled={busy || !selectedRuleId}
          title="Editar (E)"
        >
          <Edit3 className="h-3 w-3" />
          Editar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            selectedRuleId && void handleDuplicate(selectedRuleId)
          }
          disabled={busy || !selectedRuleId}
          title="Duplicar"
        >
          <Copy className="h-3 w-3" />
          Duplicar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectedRuleId && void handleTest(selectedRuleId)}
          disabled={busy || !selectedRuleId}
          title="Probar (ejecuta acción real en el juego)"
        >
          <Play className="h-3 w-3" />
          Probar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!selectedRuleId) return;
            const r = allRules.find((x) => x.id === selectedRuleId);
            if (!r) return;
            void toggle(r.id, !r.enabled);
          }}
          disabled={busy || !selectedRuleId}
          title="Habilitar/Deshabilitar"
        >
          <Power className="h-3 w-3" />
          On/Off
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => selectedRuleId && void handleDelete(selectedRuleId)}
          disabled={busy || !selectedRuleId}
          title="Eliminar"
        >
          <Trash2 className="h-3 w-3" />
          Eliminar
        </Button>
      </div>

      {importStatus && (
        <div className="px-4 py-2 text-xs border-b border-border bg-bg-elev/20">
          {importStatus}
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {!gameId ? (
          <Empty
            icon={ListChecks}
            title="Sin juego seleccionado"
            description="Configurá un juego desde el sidebar para ver sus reglas."
          />
        ) : status === 'loading' && allRules.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : status === 'error' ? (
          <Empty
            icon={ListChecks}
            title="No se pudieron cargar las reglas"
            description={error ?? 'Error desconocido'}
            action={
              <Button size="sm" onClick={() => void refresh()}>
                Reintentar
              </Button>
            }
          />
        ) : visibleRules.length === 0 ? (
          <Empty
            icon={ListChecks}
            title={search || triggerFilter !== 'all' ? 'Sin coincidencias' : 'Sin reglas todavía'}
            description={
              search || triggerFilter !== 'all'
                ? 'Probá ajustar el filtro o el texto de búsqueda.'
                : `Creá tu primera regla para ${profile?.name ?? 'el juego'}.`
            }
            action={
              !(search || triggerFilter !== 'all') && (
                <Button size="sm" onClick={openNewRule}>
                  <Plus className="h-3.5 w-3.5" />
                  Crear regla
                </Button>
              )
            }
          />
        ) : (
          // v1.1.4: layout independiente de density. Si layout='grid',
          // cards en cuadrícula 2 columnas (3 en pantallas anchas xl+).
          // Combinable con cualquier density (compact/normal/large).
          <div
            className={
              layout === 'grid'
                // v1.1.6: ADAPTATIVO con CSS auto-fit. El browser decide
                // cuántas columnas entran según el ancho disponible y el
                // mínimo de card. Sin esto las cards en pantalla ancha
                // se veían gigantes (3 cols a 600px cada una).
                //
                // minmax(MIN, 1fr): cada card mide al menos MIN pixels.
                // Si entra una más, se agrega columna. Cards estiran
                // proporcionalmente para llenar el espacio sobrante.
                //
                // density define el tamaño mínimo:
                //   compact = 150px (cards chicas, muchas por fila)
                //   normal  = 200px (mediana)
                //   large   = 260px (grandes, menos por fila)
                ? density === 'compact'
                  ? 'grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2'
                  : density === 'large'
                  ? 'grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3'
                  : 'grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5'
                : 'space-y-1.5'
            }
          >
            {visibleRules.map((r) => (
              <div
                key={r.id}
                draggable={!busy && triggerFilter === 'all' && !search}
                onDragStart={(e) => handleDragStart(r.id, e)}
                onDragOver={(e) => handleDragOver(r.id, e)}
                onDrop={(e) => handleDrop(r.id, e)}
                onDragEnd={handleDragEnd}
                className={[
                  draggingId === r.id ? 'opacity-40' : '',
                  dropTargetId === r.id && draggingId !== r.id
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-base rounded-lg'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <RuleListItem
                  rule={r}
                  gameId={gameId}
                  giftIcons={giftIcons}
                  giftCoins={giftCoins}
                  nameToCommand={nameToCommand}
                  density={density}
                  layout={layout}
                  selected={r.id === selectedRuleId}
                  onSelect={(id) => setSelectedRuleId(id)}
                  onToggle={(id, v) => void toggle(id, v)}
                  onEdit={openEditRule}
                  onDuplicate={(id) => void handleDuplicate(id)}
                  onDelete={(id) => void handleDelete(id)}
                  onTest={(id) => void handleTest(id)}
                  onQuickChangeGift={handleQuickChangeGift}
                  onQuickChangeAction={handleQuickChangeAction}
                  busy={busy}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border bg-bg-base/50">
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleImport()}
            disabled={busy || !gameId}
            title="Importar JSON de reglas"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={busy || !gameId || allRules.length === 0}
            title="Exportar reglas a JSON"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleValidateAll()}
            disabled={busy || !gameId || allRules.length === 0}
            title="Validar todas las reglas (paridad MARU validate_all_rules)"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Validar
          </Button>
        </div>
        <p className="text-[11px] text-fg-subtle">
          {gameId && `${visibleRules.length} de ${allRules.length} reglas`}
        </p>
      </footer>

      {/* v1.0.95+: confirm de eliminar y feedback de probar fueron
          MIGRADOS al sistema global (`useConfirm` + `toast`). Antes los
          divs inline en `bottom-12 right-4 z-50` se sobreponían entre
          sí (el delete con el test trace) — UX rota. Ahora cada uno
          va por su canal apropiado: confirm = ConfirmDialog centrado;
          test = toast en bottom-right del singleton. */}

      {/* Validation results */}
      {validation && (
        <div className="absolute bottom-12 right-4 z-50 max-w-[440px] max-h-[60vh] overflow-y-auto rounded-xl border border-accent/40 bg-bg-surface p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold">
              ✅ Validación · {validation.totalRules} reglas
            </p>
            <button
              type="button"
              onClick={() => setValidation(null)}
              className="text-fg-subtle hover:text-fg text-xs"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">
            {validation.error_count > 0 && `${validation.error_count} errores · `}
            {validation.warning_count > 0 && `${validation.warning_count} avisos · `}
            {validation.info_count} infos
          </p>
          {validation.problems.length === 0 && validation.conflicts.length === 0 ? (
            <p className="mt-2 text-xs text-success">
              Sin problemas detectados
            </p>
          ) : (
            <>
              {validation.problems.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px]">
                  {validation.problems.map((p, i) => (
                    <li key={i} className="rounded bg-bg-base/50 px-2 py-1">
                      <span className="text-fg-muted">[{p.rule_name}]</span>{' '}
                      {p.message}
                      {p.suggestion && (
                        <span className="block text-[10px] text-fg-subtle mt-0.5">
                          → {p.suggestion}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {validation.conflicts.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px]">
                  {validation.conflicts.map((c, i) => (
                    <li
                      key={i}
                      className="rounded bg-warning/10 border border-warning/20 px-2 py-1 text-warning"
                    >
                      ⚠️ {c.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
