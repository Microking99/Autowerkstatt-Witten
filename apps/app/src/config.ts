/**
 * Laufzeitkonfiguration über Umgebungsvariablen (werden beim Bundling eingesetzt).
 *
 * EXPO_PUBLIC_DEMO=1        Demo-Modus mit Beispieldaten (keine Netzwerkaufrufe)
 * EXPO_PUBLIC_API_URL       Basisadresse der API ohne /api/v1, z. B. https://api.example.de
 * EXPO_PUBLIC_WEB_URL       öffentliche Adresse des Browserzugangs (für Links in Freigaben)
 * EXPO_PUBLIC_CHECK_API=1   API-Antworten auch im Export mit den zod-Schemas prüfen (nur Tests)
 * EXPO_PUBLIC_PREVIEW=1     Vorschau für Vorführungen: Demo-Modus mit Einstiegsseite /vorschau und
 *                           zusätzlichen Beispieldaten (nur zusammen mit EXPO_PUBLIC_DEMO=1)
 *
 * App-Kennung (app.json: ios.bundleIdentifier / android.package = de.autowerkstattwitten.app)
 * und Domain sind Platzhalter: offene Entscheidung O-12 (docs/offene-entscheidungen.md).
 */
export const IS_DEMO = process.env.EXPO_PUBLIC_DEMO === '1';
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? '').trim();
export const CHECK_API_RESPONSES = process.env.EXPO_PUBLIC_CHECK_API === '1';
export const IS_PREVIEW = IS_DEMO && process.env.EXPO_PUBLIC_PREVIEW === '1';

export const WORKSHOP_NAME = 'Autowerkstatt Witten';
