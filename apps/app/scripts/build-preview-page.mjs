// Baut aus dem Vorschau-Export (dist-preview) eine einzelne, eigenständige Seite zum Teilen.
//
//   node scripts/build-preview-page.mjs [ausgabe.html]
//
// - Das JS-Bündel wird eingebettet (keine weiteren Dateien nötig).
// - Die Seite enthält kein <html>/<head>/<body>: Sie wird beim Veröffentlichen in ein
//   Grundgerüst eingebettet. Titel und Stile stehen am Anfang.
// - Expo Router liest den Pfad aus der Adresse. Der Rahmen, in dem die Seite läuft, hat einen
//   eigenen Pfad; deshalb startet die App immer bei "/" (danach Einstieg /vorschau).
// - Farbschema: Setzt der Rahmen data-theme="dark"|"light", gilt das für die App wie die
//   Systemeinstellung.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve('dist-preview');
const out = resolve(process.argv[2] ?? join(root, 'vorschau-seite.html'));

const html = readFileSync(join(root, 'index.html'), 'utf8');
const src = html.match(/<script src="\/(_expo\/static\/js\/web\/[^"]+\.js)"/)?.[1];
if (!src) throw new Error('Kein Skript im Export gefunden. Zuerst "pnpm --filter @werkstatt/app export:preview" ausführen.');
let js = readFileSync(join(root, src), 'utf8');

// Inline-Skript absichern: "</script" würde das Element beenden, "<!--" kann den Parser in einen
// Sonderzustand bringen. "<\!--" ist in Zeichenketten und regulären Ausdrücken ohne u-Flag gleich.
if (/<\/script/i.test(js)) throw new Error('Bündel enthält "</script" und kann nicht eingebettet werden.');
js = js.replaceAll('<!--', '<\\!--');

const boot = `
(function () {
  try {
    var known = /^\\/(vorschau|anmelden|kunde|werkstatt|mechaniker|q|f|zahlung|einladung|passwort|nicht-verfuegbar)(\\/|$)/;
    if (!known.test(location.pathname)) history.replaceState(history.state, '', '/');
  } catch (e) {}
  try {
    var mm = window.matchMedia.bind(window);
    window.matchMedia = function (q) {
      var th = document.documentElement.getAttribute('data-theme');
      if ((th === 'dark' || th === 'light') && /prefers-color-scheme/.test(q)) {
        var m = /dark/.test(q) ? th === 'dark' : th === 'light';
        var noop = function () {};
        return { matches: m, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: function () { return false; } };
      }
      return mm(q);
    };
  } catch (e) {}
})();
`;

const page = `<title>Autowerkstatt Witten Vorschau</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root { --page-bg: #f3f4f6; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page-bg: #0f1215; color-scheme: dark; } }
  :root[data-theme="dark"] { --page-bg: #0f1215; color-scheme: dark; }
  html, body { height: 100%; background: var(--page-bg); }
  body { overflow: hidden; }
  #root { display: flex; height: 100%; flex: 1; }
</style>
<noscript>Bitte aktivieren Sie JavaScript, um die Vorschau zu sehen.</noscript>
<div id="root"></div>
<script>${boot}</script>
<script>${js}</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`Vorschauseite: ${out} (${(Buffer.byteLength(page) / 1024 / 1024).toFixed(2)} MB)`);
