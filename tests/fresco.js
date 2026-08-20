// 🖌️ THE FRESCO ENGINE — the country-shader filter is retired, and with it the
// blue flash: nothing on the political map re-rasterises through a blur any
// more. The look is rebuilt in plain vectors: paperized fills and a clipped
// double-stroke rim on each nation's union outline.
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
    if (c) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${n}`); }
    else { fail++; console.log(`  \x1b[31m✘ ${n}\x1b[0m${e ? '  → ' + e : ''}`); }
};
(async () => {
    const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', e => { if (!/Panzoom/.test(e.message)) errs.push(e.message); });
    await p.goto('http://localhost:3100/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    await p.evaluate(() => {
        document.getElementById('game-screen').classList.remove('hidden');
        selectPresetNation('France', '#3b1cd6', '🇫🇷');
        mySelectedCapital = 'Paris';
        initializeTheaterMap('Europe', [
            { id: 'seat_1', name: 'Me', isHost: true, isAI: false, nation: { name: 'France', color: '#3b1cd6', capital: 'Paris', flag: '🇫🇷' } },
            { id: 'ai_1', name: '🤖 Spain', isHost: false, isAI: true, nation: { name: 'Spain', color: '#e0d01d', capital: 'Madrid', flag: '🇪🇸' } }
        ], 'seat_1', false);
    });
    await p.waitForTimeout(2800);

    console.log('\n\x1b[1m— the filter is gone from the political map —\x1b[0m');
    const paint = await p.evaluate(async () => {
        const seed = (f, c, list) => list.forEach(rid => {
            if (!document.getElementById(rid)) return;
            localClaimedProvinces[rid] = { owner: f, color: c };
            applyProvinceToNation(rid, c, f);
        });
        seed('🤖 Spain', '#e0d01d', FORMABLE_REQUIREMENTS['Hispania'].slice());
        seed('🇫🇷 France', '#3b1cd6', ['region-76', 'region-86', 'region-97', 'region-80', 'region-95']);
        await new Promise(r => setTimeout(r, 400));   // the 80ms batch flushes
        const filtered = document.querySelectorAll('#claimed-layer [filter]').length;
        const spainGroup = document.getElementById('nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-'));
        const rims = spainGroup ? spainGroup.querySelectorAll('.nation-rim') : [];
        const clip = document.getElementById('rimclip-nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-').replace('nation-', ''));
        const clipEl = document.getElementById('rimclip-' + 'nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-'));
        const aPath = document.getElementById(FORMABLE_REQUIREMENTS['Hispania'][0]);
        return {
            filtered,
            rimCount: rims.length,
            rimClipped: rims.length === 2 && [...rims].every(r => /rimclip/.test(r.getAttribute('clip-path') || '')),
            rimStroked: rims.length === 2 && [...rims].every(r => (r.getAttribute('stroke') || '').startsWith('rgb')),
            rimNoFill: rims.length === 2 && [...rims].every(r => r.getAttribute('fill') === 'none'),
            clipInDefs: !!clipEl && !!clipEl.firstChild && (clipEl.firstChild.getAttribute('d') || '').length > 10,
            paperized: aPath ? aPath.style.color.startsWith('rgb') : false
        };
    });
    ok('no nation on the map carries a filter any more', paint.filtered === 0, String(paint.filtered));
    ok('each realm wears its fresco rim (soft band + tight core)', paint.rimCount === 2, String(paint.rimCount));
    ok('the rim is clipped to the realm\'s own soil', paint.rimClipped === true);
    ok('and stroked in the realm\'s darkened colour', paint.rimStroked === true);
    ok('with no fill of its own', paint.rimNoFill === true);
    ok('the clip lives in the defs with real geometry', paint.clipInDefs === true);
    ok('fills are paperized — the old filter\'s warm wash, baked in', paint.paperized === true);

    console.log('\n\x1b[1m— conquest re-dresses the rim —\x1b[0m');
    const conquest = await p.evaluate(async () => {
        const safe = 'nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-');
        const before = document.getElementById('rimclip-' + safe).firstChild.getAttribute('d');
        // France takes northern Iberia
        ['region-106', 'region-447', 'region-143', 'region-130'].forEach(rid => {
            localClaimedProvinces[rid] = { owner: '🇫🇷 France', color: '#3b1cd6' };
            applyProvinceToNation(rid, '#3b1cd6', '🇫🇷 France');
        });
        await new Promise(r => setTimeout(r, 400));
        const after = document.getElementById('rimclip-' + safe).firstChild.getAttribute('d');
        return { changed: before !== after };
    });
    ok('the rim redraws to the new border', conquest.changed === true);

    console.log('\n\x1b[1m— a realm conquered whole loses its rim with its name —\x1b[0m');
    const gone = await p.evaluate(async () => {
        FORMABLE_REQUIREMENTS['Hispania'].forEach(rid => {
            if (!document.getElementById(rid)) return;
            localClaimedProvinces[rid] = { owner: '🇫🇷 France', color: '#3b1cd6' };
            applyProvinceToNation(rid, '#3b1cd6', '🇫🇷 France');
        });
        await new Promise(r => setTimeout(r, 400));
        const safe = 'nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-');
        const g = document.getElementById(safe);
        return {
            rims: g ? g.querySelectorAll('.nation-rim').length : 0,
            clip: !!document.getElementById('rimclip-' + safe)
        };
    });
    ok('the fallen realm\'s rim is gone', gone.rims === 0, String(gone.rims));
    ok('and its clip with it', gone.clip === false);

    console.log('\n\x1b[1m— hover no longer has a filter to blank —\x1b[0m');
    const hover = await p.evaluate(() => {
        // the mechanism itself is gone: nothing in the claimed layer is filtered,
        // so a hover class toggle re-renders cheap vectors, not a blurred raster
        const el = document.querySelector('#claimed-layer path[id^="region-"]');
        if (el) {
            el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
            el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
        }
        return { filteredAnywhere: document.querySelectorAll('#map-svg [filter]').length };
    });
    ok('nothing on the chart renders through a filter', hover.filteredAnywhere === 0, String(hover.filteredAnywhere));

    ok('no page errors through the whole run', errs.length === 0, errs.join(' | '));
    await b.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BLEW UP', e); process.exit(2); });
