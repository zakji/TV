// Assembles the static site: app/ + data/ → _site/
import { cp, rm, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const out = new URL('_site/', root);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(new URL('app/', root), out, { recursive: true, filter: (src) => !src.includes('/app/src') });
await cp(new URL('data/', root), new URL('data/', out), { recursive: true });
await cp(new URL('app/icons/icon-192.png', root), new URL('favicon.png', out));
console.log('site built → _site/');
