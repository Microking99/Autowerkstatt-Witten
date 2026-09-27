/**
 * Browser: <img> kann keinen Authorization-Header senden. Geschützte Bilder werden daher per
 * fetch mit Bearer-Token geladen und als Blob-URL angezeigt; die URL wird beim Verlassen der
 * Ansicht wieder freigegeben. Quellen ohne Header (Daten-URI, Demo) werden direkt genutzt.
 */
import { useEffect, useState } from 'react';
import type { ImageSourceSpec } from '../data/api';

export type AuthImageState = { status: 'ready'; uri: string; headers?: Record<string, string> } | { status: 'loading' } | { status: 'error' };

export function useAuthImage(source: ImageSourceSpec): AuthImageState {
  const needsFetch = !!source.uri && !!source.headers?.Authorization && /^https?:/.test(source.uri);
  const [state, setState] = useState<AuthImageState>(needsFetch ? { status: 'loading' } : { status: 'ready', uri: source.uri });
  const auth = source.headers?.Authorization;

  useEffect(() => {
    if (!needsFetch) {
      setState({ status: 'ready', uri: source.uri });
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    fetch(source.uri, { headers: source.headers })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', uri: objectUrl });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Quelle und Anmeldung bestimmen das Bild; das Header-Objekt selbst wechselt je Aufruf
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.uri, auth, needsFetch]);

  return state;
}
