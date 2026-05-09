import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * `ErrorBoundary` — última red de seguridad de React.
 *
 * Si CUALQUIER componente del árbol throw-ea durante render/commit
 * (ej. violación Rules of Hooks, undefined access, etc), React por
 * default DESMONTA todo el árbol — el DOM queda vacío y el user ve
 * una pantalla negra hasta reiniciar la app.
 *
 * Esta boundary captura ese throw, loguea el error y renderiza un
 * fallback con un botón "Recargar". Garantiza que NUNCA quede
 * pantalla muda incluso ante bugs latentes.
 *
 * Bug histórico v1.0.62: NowPlayingCard violaba Rules of Hooks al
 * conectar Spotify → throw → árbol vacío → pantalla negra. Sin
 * ErrorBoundary el user tenía que reiniciar. Con esta clase el bug
 * queda VISIBLE en una card de error con stack trace y opción de
 * reload, en vez de matar la app.
 */
interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

interface Props {
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log al main process via console (electron forwarding lo manda al
    // archivo de logs y al stdout del main).
    console.error('[ErrorBoundary] React caught:', error, info);
    this.setState({ info });
  }

  handleReload = (): void => {
    // Soft reset: limpia el state y deja que React re-renderice. Si
    // el bug persiste, el siguiente render volverá al fallback.
    this.setState({ error: null, info: null });
  };

  handleHardReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error);
      const stack = this.state.info?.componentStack || this.state.error.stack || '';
      return (
        <div
          role="alertdialog"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: 'rgb(20, 20, 32)',
            color: '#e6e6f0',
            fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              maxWidth: 720,
              width: '100%',
              borderRadius: 16,
              border: '1px solid rgba(255, 80, 80, 0.4)',
              background: 'rgba(40, 20, 24, 0.95)',
              padding: 24,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Algo se rompió en la interfaz
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#c8c8d6', lineHeight: 1.5 }}>
              MARU detectó un error de renderizado y evitó que la pantalla
              quede en blanco. Probablemente al actualizar a la próxima
              versión se solucione, pero por ahora podés recargar para
              seguir trabajando.
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  background: 'rgb(120, 80, 220)',
                  color: '#fff',
                  border: 0,
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Reintentar render
              </button>
              <button
                type="button"
                onClick={this.handleHardReload}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Recargar app
              </button>
            </div>
            <details style={{ marginTop: 18 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#a8a8b8',
                  userSelect: 'none',
                }}
              >
                Detalles técnicos (compartilo con el dev)
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: 8,
                  fontSize: 11,
                  color: '#ff9090',
                  overflow: 'auto',
                  maxHeight: 240,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <strong>{msg}</strong>
                {'\n'}
                {stack}
              </pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
