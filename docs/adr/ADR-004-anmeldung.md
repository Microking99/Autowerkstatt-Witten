# ADR-004: Anmeldung, Sitzungen, Einladungen

- **Status:** angenommen
- **Datum:** 2026-09-26
- **Bezug:** R-ARCH-3, R-ROLLE-6, R-ADM-1

## Kontext

Mitarbeiter und Kunden melden sich mit E-Mail und Passwort an. Kundenkonten entstehen nur
per Einladung zu einem bestehenden Kundendatensatz. Deaktivierung und Passwort-Reset müssen
alle Sitzungen **sofort** beenden. Es gibt genau eine Werkstatt und keinen externen
Identitätsanbieter.

## Entscheidung

- **Eigene Sitzungen** mit **undurchsichtigen Tokens** (256 Bit Zufall). Die Datenbank
  speichert nur den SHA-256-Hash (`sessions.token_hash`), dazu Ablauf, letzte Nutzung,
  Widerruf, Gerät. Übertragung als `Authorization: Bearer <token>`.
- **Keine JWT:** Ein sofortiger Widerruf verlangt ohnehin einen Serverzustand; undurchsichtige
  Tokens brauchen keine Schlüsselverwaltung und verraten keine Inhalte.
- **Passwörter mit argon2id**; Parameter legt P-03 fest und dokumentiert sie.
- **Einladungen** (Mitarbeiter und Kunden): einmal verwendbar, 7 Tage gültig, nur Hash
  gespeichert. Annahme setzt das Passwort und meldet an.
- **Passwort-Reset:** Anfrage antwortet immer gleich (`204`), Link 1 Stunde gültig, einmal
  verwendbar; Erfolg beendet alle Sitzungen.
- **Schutz:** Rate-Limits auf allen öffentlichen Anmeldeendpunkten, Zähler für Fehlversuche
  mit zeitweiser Sperre, Protokollierung erfolgreicher und fehlgeschlagener Anmeldungen.
- **Speicherung im Client:**
  - iOS/Android: sicherer Gerätespeicher (`expo-secure-store`, Keychain bzw. Keystore).
  - Browser und Windows-Hülle: nur `sessionStorage` (Token endet mit dem Tab bzw. Fenster).
    **Offene Entscheidung O-21:** Umstellung auf HttpOnly-Cookie.
- **Sitzungsdauer:** gleitend mit absoluter Obergrenze; Werte legt P-03 fest.
- **Zwei-Faktor für Mitarbeiter:** **offene Entscheidung O-14** (Datenmodell wird nicht
  blockiert).

## Alternativen

| Alternative | Warum nicht gewählt |
|---|---|
| JWT mit kurzer Laufzeit und Refresh-Token | Widerruf erst nach Ablauf oder mit Sperrliste; zusätzliche Schlüsselverwaltung ohne Nutzen bei einer einzigen API. |
| Supabase Auth / externer Identitätsanbieter | Bindung an einen Anbieter für einen Kernbaustein; Einladungen zu bestehenden Kundendatensätzen und sofortige Deaktivierung müssten trotzdem selbst gebaut werden (ADR-002). |
| HttpOnly-Cookie sofort im Browser | Schützt das Token vor Auslesen durch Skripte, verlangt aber CSRF-Schutz und eine Domain-Festlegung für App und API (O-12). Wird als O-21 entschieden. |
| `localStorage` im Browser | Token überdauert das Schließen und ist für Skripte lesbar; unnötig langes Risiko. |

## Folgen

- Im Browser und in der Windows-Hülle ist nach dem Schließen eine neue Anmeldung nötig.
- Eine Skript-Einschleusung (XSS) im Web-Client könnte das Token aus `sessionStorage` lesen.
  Gegenmaßnahmen: strenge Content-Security-Policy, keine Fremdskripte, Ausgabe-Escaping;
  endgültig mit O-21.
- Tests: Anmeldung, Sperre, Einladung (abgelaufen, benutzt), Reset beendet Sitzungen,
  Deaktivierung beendet Sitzungen (P-03, C-01).
