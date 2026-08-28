/**
 * Bundles the whole game into ONE self-contained HTML page — no modules, no
 * CDN, no separate assets — so it can be published somewhere and played from a
 * phone without a checkout or a toolchain.
 *
 *   npm run artifact            -> writes to dist-artifact/apex-drift.html
 *   npm run artifact -- <path>  -> writes wherever you point it
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const out = resolve(process.argv[2] || 'dist-artifact/apex-drift.html');

console.log('building bundle...');
execSync('npx vite build --config vite.artifact.config.js', { stdio: 'inherit' });

const js = readFileSync('dist-artifact/game.js', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');

// The markup, lifted from index.html minus the document shell: a published page
// is injected into one that already has <head> and <body>.
const body = readFileSync('index.html', 'utf8')
  .replace(/[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .replace(/\n?\s*<script[\s\S]*?<\/script>/g, '')
  .trim();

const page = `<title>Apex Drift</title>
<style>
${css}
</style>

${body}

<script>
${js}
</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
const kb = (page.length / 1024).toFixed(0);
console.log(`\nwrote ${out} (${kb} KB, self-contained)`);
