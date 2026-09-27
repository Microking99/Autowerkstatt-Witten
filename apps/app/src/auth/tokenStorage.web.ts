/**
 * Browser: Token nur im sessionStorage des Tabs.
 *
 * Begründung: Im Browser soll kein dauerhaftes Anmeldetoken liegen (kein localStorage). Mit
 * dem Schließen des Tabs endet die Anmeldung. sessionStorage ist aber per JavaScript lesbar;
 * die geplante Umstellung auf ein HttpOnly-Cookie (Secure, SameSite=Strict) mit CSRF-Schutz
 * ist eine offene Entscheidung für API und Browserzugang (siehe Übergabe APP-1).
 */
const TOKEN_KEY = 'werkstatt.sitzung';
const USER_KEY = 'werkstatt.konto';

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export const tokenStorage = {
  async load(): Promise<{ token: string | null; userJson: string | null }> {
    const s = store();
    return { token: s?.getItem(TOKEN_KEY) ?? null, userJson: s?.getItem(USER_KEY) ?? null };
  },
  async save(token: string, userJson: string): Promise<void> {
    const s = store();
    s?.setItem(TOKEN_KEY, token);
    s?.setItem(USER_KEY, userJson);
  },
  async saveUser(userJson: string): Promise<void> {
    store()?.setItem(USER_KEY, userJson);
  },
  async clear(): Promise<void> {
    const s = store();
    s?.removeItem(TOKEN_KEY);
    s?.removeItem(USER_KEY);
  },
};
