import { Button } from '@maru/ui';
import type { SocialCategoryMeta, SocialConfig } from '@maru/shared';

/**
 * `CommandsTab` — TAB 2 del SocialConfigDialog.
 *
 * Réplica del grid de checkboxes agrupados por categoría. Cada categoría
 * muestra header (icono + nombre + desc) + grid 4 cols con checkboxes.
 *
 * Mejoras vs MARU original:
 *   - "Seleccionar todos" / "Deseleccionar" filtran solo a los comandos
 *     visibles en pantalla (más útil cuando hay muchas categorías).
 *   - Tooltip muestra description del comando.
 */
export interface CommandsTabProps {
  config: SocialConfig;
  meta: Record<string, SocialCategoryMeta>;
  patch: (p: Partial<SocialConfig>) => void;
  disabled?: boolean;
}

function isEnabled(config: SocialConfig, cmd: string): boolean {
  return config.enabled_commands.includes(cmd);
}

export function CommandsTab({
  config,
  meta,
  patch,
  disabled = false,
}: CommandsTabProps) {
  const allCmds = Object.values(meta).flatMap((c) =>
    c.commands.map((x) => x.cmd),
  );

  function toggleCmd(cmd: string, on: boolean) {
    const next = new Set(config.enabled_commands);
    if (on) next.add(cmd);
    else next.delete(cmd);
    patch({ enabled_commands: Array.from(next) });
  }

  function toggleCategory(catId: string, on: boolean) {
    const cmds = meta[catId]?.commands.map((c) => c.cmd) ?? [];
    const next = new Set(config.enabled_commands);
    for (const c of cmds) {
      if (on) next.add(c);
      else next.delete(c);
    }
    patch({ enabled_commands: Array.from(next) });
  }

  function selectAll(on: boolean) {
    patch({ enabled_commands: on ? allCmds : [] });
  }

  const enabledCount = config.enabled_commands.filter((c) =>
    allCmds.includes(c),
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg-elev/30 px-3 py-2">
        <p className="text-xs text-fg-muted">
          <strong>{enabledCount}</strong> de {allCmds.length} comandos
          activos. Los desactivados no responden cuando un viewer los usa.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => selectAll(true)}
            disabled={disabled}
          >
            ✅ Seleccionar Todos
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => selectAll(false)}
            disabled={disabled}
          >
            ❌ Deseleccionar
          </Button>
        </div>
      </div>

      {Object.entries(meta).map(([catId, cat]) => {
        const allCatOn =
          cat.commands.length > 0 &&
          cat.commands.every((c) => isEnabled(config, c.cmd));
        const someCatOn =
          cat.commands.length > 0 &&
          cat.commands.some((c) => isEnabled(config, c.cmd));
        return (
          <fieldset
            key={catId}
            className="rounded-xl border border-border bg-bg-elev/30 p-3 space-y-2"
          >
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              {cat.icon} {cat.name}
            </legend>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-fg-subtle">{cat.desc}</p>
              <button
                type="button"
                onClick={() => toggleCategory(catId, !allCatOn)}
                disabled={disabled}
                className="text-[11px] text-info hover:underline"
              >
                {allCatOn
                  ? 'Desactivar todos'
                  : someCatOn
                    ? 'Activar todos'
                    : 'Activar todos'}
              </button>
            </div>
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              }}
            >
              {cat.commands.map((c) => {
                const on = isEnabled(config, c.cmd);
                return (
                  <label
                    key={c.cmd}
                    className={[
                      'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer',
                      'transition-colors',
                      on
                        ? 'border-accent/40 bg-accent/10 text-fg'
                        : 'border-border bg-bg-elev text-fg-muted hover:border-fg-muted',
                    ].join(' ')}
                    title={c.desc || c.name}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => toggleCmd(c.cmd, e.target.checked)}
                      disabled={disabled}
                      className="h-3 w-3 accent-accent"
                    />
                    <span className="font-emoji">{c.icon}</span>
                    <span className="font-mono">!{c.cmd}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
