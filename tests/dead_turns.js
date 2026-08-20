// ⚰️ THE DEAD DON'T DELIBERATE — a knocked-out nation's turn must fly past,
// not sit at the table pretending to think. A LIVING machine still takes its
// (brisker, ×0.4) beat so the table stays legible.
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
            { id: 'ai_1', name: '🤖 Spain', isHost: false, isAI: true, nation: { name: 'Spain', color: '#c0392b', capital: 'Madrid', flag: '🇪🇸' } }
        ], 'seat_1', false);
        amIHost = true;
    });
    await p.waitForTimeout(2800);

    console.log('\n\x1b[1m— a fallen machine\'s turn flies past —\x1b[0m');
    const dead = await p.evaluate(async () => {
        eliminatedNations.add('🤖 Spain');
        window.__emitted = [];
        const t0 = performance.now();
        executeAITurn('🤖 Spain', { name: 'Spain', color: '#c0392b', capital: 'Madrid', flag: '🇪🇸' });
        let elapsed = -1;
        for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 20));
            if (JSON.stringify(window.__emitted).includes('endTurn')) { elapsed = performance.now() - t0; break; }
        }
        return { elapsed: Math.round(elapsed) };
    });
    ok('the turn is passed at all', dead.elapsed >= 0, 'never ended');
    ok('and passed FAST — no thinking pause for the dead',
        dead.elapsed >= 0 && dead.elapsed < 450, `${dead.elapsed}ms`);

    console.log('\n\x1b[1m— a living machine keeps a visible (brisker) beat —\x1b[0m');
    const alive = await p.evaluate(async () => {
        eliminatedNations.delete('🤖 Spain');
        const ids = [...document.querySelectorAll('#map-layer path')].map(x => x.id).filter(Boolean).slice(0, 6);
        ids.forEach(r => { localClaimedProvinces[r] = { owner: '🤖 Spain', color: '#c0392b' }; applyProvinceToNation(r, '#c0392b', '🤖 Spain'); });
        window.__emitted = [];
        const t0 = performance.now();
        executeAITurn('🤖 Spain', { name: 'Spain', color: '#c0392b', capital: 'Madrid', flag: '🇪🇸' });
        let elapsed = -1;
        for (let i = 0; i < 600; i++) {
            await new Promise(r => setTimeout(r, 25));
            if (JSON.stringify(window.__emitted).includes('endTurn')) { elapsed = performance.now() - t0; break; }
        }
        return { elapsed: Math.round(elapsed), tempo: aiMs(1000) };
    });
    ok('the tempo is brisk — ×0.4, not the old amble', alive.tempo === 400, String(alive.tempo));
    ok('a living nation\'s turn still carries a visible beat',
        alive.elapsed >= 400, `${alive.elapsed}ms`);
    ok('…but a much quicker one than the fallen used to get',
        alive.elapsed >= 0 && alive.elapsed < 8000, `${alive.elapsed}ms`);

    console.log('\n\x1b[1m— and a fallen PLAYER\'s seat passes just as fast —\x1b[0m');
    const me = await p.evaluate(async () => {
        eliminatedNations.add(mySelectedFaction);
        iHaveHeldLand = true;
        window.__emitted = [];
        const t0 = performance.now();
        handleTurnChange(meId(), 'Me', { name: 'France', flag: '🇫🇷' }, false, 991);
        let elapsed = -1;
        for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 20));
            if (JSON.stringify(window.__emitted).includes('endTurn')) { elapsed = performance.now() - t0; break; }
        }
        const banner = document.getElementById('turn-status-banner').innerText;
        eliminatedNations.delete(mySelectedFaction);
        return { elapsed: Math.round(elapsed), banner };
    });
    ok('the fallen seat passes itself', me.elapsed >= 0, 'never ended');
    ok('within half a second, not two', me.elapsed >= 0 && me.elapsed < 700, `${me.elapsed}ms`);
    ok('while still saying what happened', /fallen/i.test(me.banner), me.banner);

    ok('no page errors through the whole run', errs.length === 0, errs.join(' | '));
    await b.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BLEW UP', e); process.exit(2); });
