'use client';
import { useEffect } from 'react';

interface ReticleDevProps {
  /** Disuntik dari server component (audit M14) — tidak pernah masuk bundle produksi. */
  token?: string;
  root?: string;
  url?: string;
}

/** Dev-only: connect Reticle + install the React adapter, after hydration. */
export function ReticleDev({ token, root, url }: ReticleDevProps) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    void import('@reticlehq/react').then(
      ({ reticle, install, registerCapabilities }) => {
        install();
        // withReticle() finds the daemon serving this project on every dev-server start. It wins over
        // any port written into this file at install time, so moving the daemon needs no edit here.
        reticle.connect({
          projectId: 'my-project-8b92cfea', ...(url ? { url } : {}),
          ...(token ? { token } : {}),
          ...(root ? { root } : {}),
        });

        // ── Start with ONE flow. ────────────────────────────────────────────────────────────────
        // Registering a store is the highest-value line here: it lets the agent check what the app
        // BELIEVES, not just what it rendered. Pass the STORE, not `() => store.getState()` — the
        // store form wires `subscribe` too, so every mutation emits a diff; the getter form is
        // read-only.
        // No state library detected. If you add one, register it here — see node_modules/@reticlehq/server/docs/usage.md.
        registerCapabilities({
          testids: [], // none found; add data-testid to your key elements
          signals: ['onboarding_genre_selected'], // names you pass to reticle.signal()
          stores: [], // the keys you registered above
        });
      },
    );
  }, []);
  return null;
}
