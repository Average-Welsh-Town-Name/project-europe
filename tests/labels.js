// 🖋️ THE NAME MUST NOT TRESPASS — BUT IT MAY STEP OVER. A nation's map label
// may lie over its own land and waters, may step across a neighbour's small
// protrusion (Hungary jutting into Austria must not shrink Austria's name),
// but must never begin or end abroad, nor spend more than about a third of
// its length on someone else's soil.
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
        // one reader for every scene below: the ribbon, read back for judgment
        window.__readRibbon = () => {
            const safeId = 'nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-');
            const group = document.querySelector(`#nation-labels-layer [id^="textgroup-${safeId}"]`);
            if (!group) return { labelled: false };
            const def = document.querySelector(`#text-paths-defs [id^="textpathdef-${safeId}"]`);
            const m = def.getAttribute('d').match(/M ([-\d.]+),([-\d.]+) Q ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/);
            const rot = (group.getAttribute('transform') || '').match(/rotate\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
            if (!m || !rot) return { labelled: true, parsed: false };
            const [sx, sy, cx, cy, ex, ey] = m.slice(1).map(Number);
            const [a, ox, oy] = rot.slice(1).map(Number);
            const rad = a * Math.PI / 180, cosA = Math.cos(rad), sinA = Math.sin(rad);
            const turn = (x, y) => ({ x: ox + (x - ox) * cosA - (y - oy) * sinA,
                                      y: oy + (x - ox) * sinA + (y - oy) * cosA });
            const french = Object.keys(localClaimedProvinces)
                .filter(r => localClaimedProvinces[r].owner === '🇫🇷 France')
                .map(r => document.getElementById(r)).filter(Boolean);
            const probe = new DOMPoint();
            const onFrance = (x, y) => french.some(el => {
                probe.x = x; probe.y = y;
                try { return el.isPointInFill(probe); } catch (e) { return false; }
            });
            let trespass = 0; const marks = [];
            for (let i = 0; i <= 30; i++) {
                const t = i / 30;
                const qx = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex;
                const qy = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey;
                const pt = turn(qx, qy);
                const hit = onFrance(pt.x, pt.y);
                marks.push(hit); if (hit) trespass++;
            }
            return { labelled: true, parsed: true, trespass, samples: marks.length,
                     startsAbroad: marks[0], endsAbroad: marks[marks.length - 1],
                     font: parseFloat(group.getAttribute('font-size')),
                     width: Math.hypot(ex - sx, ey - sy) };
        };
        window.__paint = (f, c, list) => list.forEach(rid => {
            if (!document.getElementById(rid)) return;
            localClaimedProvinces[rid] = { owner: f, color: c };
            applyProvinceToNation(rid, c, f);
        });
    });
    await p.waitForTimeout(2800);

    console.log('\n\x1b[1m— alone in Iberia, the name spans the realm —\x1b[0m');
    const baseline = await p.evaluate(() => {
        window.__paint('🤖 Spain', '#e0d01d', FORMABLE_REQUIREMENTS['Hispania'].slice());
        renderNationLabelNow('🤖 Spain', '#e0d01d');
        return window.__readRibbon();
    });
    ok('the realm signs its name', baseline.labelled && baseline.parsed);
    ok('with a ribbon of real length', baseline.width >= 200, String(baseline.width));

    console.log('\n\x1b[1m— a protrusion mid-realm is STEPPED OVER, not shrunk from —\x1b[0m');
    // France takes Castilla — dead centre of Iberia, exactly the Hungary-into-
    // Austria geometry from the report. The name must ride across it.
    const step = await p.evaluate((w0) => {
        window.__paint('🇫🇷 France', '#3b1cd6', ['region-422']);
        renderNationLabelNow('🤖 Spain', '#e0d01d');
        const r = window.__readRibbon();
        r.keptShare = r.width / w0;
        return r;
    }, baseline.width);
    ok('the name keeps its stretch across the realm', step.keptShare >= 0.75,
        `kept ${(step.keptShare * 100).toFixed(0)}% of its span`);
    ok('it may stand partly over the intruder…', step.trespass <= Math.ceil(step.samples * 0.4), `${step.trespass}/${step.samples}`);
    ok('…but never BEGINS abroad', step.startsAbroad === false);
    ok('…and never ENDS abroad', step.endsAbroad === false);

    console.log('\n\x1b[1m— encircled, the name still lies MOSTLY on honest ground —\x1b[0m');
    const ringed = await p.evaluate(() => {
        const spain = FORMABLE_REQUIREMENTS['Hispania'].slice();
        const ring = new Set();
        spain.forEach(rid => (adjacencyMap[rid] || []).forEach(n => { if (!spain.includes(n)) ring.add(n); }));
        window.__paint('🇫🇷 France', '#3b1cd6', [...ring]);
        renderNationLabelNow('🤖 Spain', '#e0d01d');
        return window.__readRibbon();
    });
    ok('the encircled realm still signs its name', ringed.labelled && ringed.parsed);
    ok('most of the ribbon stands on its own ground',
        ringed.trespass <= Math.ceil(ringed.samples * 0.4), `${ringed.trespass}/${ringed.samples} abroad`);
    ok('it does not BEGIN on the rival\'s soil', ringed.startsAbroad === false);
    ok('nor END there', ringed.endsAbroad === false);
    ok('and stays legible', ringed.font >= 6.5, String(ringed.font));

    console.log('\n\x1b[1m— the conquered leave no floating names —\x1b[0m');
    const gone = await p.evaluate(() => {
        window.__paint('🇫🇷 France', '#3b1cd6', FORMABLE_REQUIREMENTS['Hispania'].slice());
        renderNationLabelNow('🤖 Spain', '#e0d01d');
        const safeId = 'nation-' + '🤖 Spain'.replace(/[^a-zA-Z0-9]/g, '-');
        return { label: !!document.querySelector(`#nation-labels-layer [id^="textgroup-${safeId}"]`) };
    });
    ok('a nation with no land has no name on the map', gone.label === false);

    ok('no page errors through the whole run', errs.length === 0, errs.join(' | '));
    await b.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BLEW UP', e); process.exit(2); });
