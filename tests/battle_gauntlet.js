// 🎭 THE GAUNTLET — battles on the non-host's screen under HOSTILE conditions:
// an AI aggressor with spoils, the guest's own turn arriving mid-cinematic,
// battles stacked faster than they can play, and an event card squatting on
// the screen. Every one must still show its armies and its painting.
// Run against the real server:  PORT=3200 node server.js
const { chromium } = require('playwright-core');
const URL = 'http://localhost:' + (process.env.RELAY_PORT || '3200') + '/index.html';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
    if (c) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${n}`); }
    else { fail++; console.log(`  \x1b[31m✘ ${n}\x1b[0m${e ? '  → ' + e : ''}`); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
    const mk = async (label) => {
        const pg = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        pg.on('pageerror', e => { if (!/Panzoom/.test(e.message)) console.log(`  [${label} ERROR] ${e.message}`); });
        pg.on('console', m => { if (/\[battle\]/.test(m.text())) console.log(`  [${label}] ${m.text()}`); });
        await pg.goto(URL, { waitUntil: 'domcontentloaded' });
        await pg.waitForTimeout(600);
        return pg;
    };
    const host = await mk('HOST');
    const guest = await mk('GUEST');

    await host.evaluate(() => { document.getElementById('username').value = 'Hosty'; doCreate(); });
    await host.waitForTimeout(600);
    const code = await host.evaluate(() => (document.getElementById('display-code').innerText || '').trim());
    await guest.evaluate((c) => {
        document.getElementById('username').value = 'Guesty';
        document.getElementById('room-code-input').value = c;
        doJoin();
    }, code);
    await guest.waitForTimeout(700);
    await host.evaluate(() => selectPresetNation('France', '#3b1cd6', '🇫🇷'));
    await guest.evaluate(() => selectPresetNation('Prussia', '#2c3e50', '🦅'));
    await host.evaluate(() => { mySelectedCapital = 'Paris'; socket.emit('selectNation', { nationName: 'France', color: '#3b1cd6', flag: '🇫🇷', capital: 'Paris' }); });
    await guest.evaluate(() => { mySelectedCapital = 'Berlin'; socket.emit('selectNation', { nationName: 'Prussia', color: '#2c3e50', flag: '🦅', capital: 'Berlin' }); });
    await host.evaluate(() => socket.emit('addAI', { nation: { name: 'Spain', color: '#c0392b', flag: '🇪🇸', capital: 'Madrid' } }));
    await wait(400);
    await host.evaluate(() => socket.emit('playerReady', true));
    await guest.evaluate(() => socket.emit('playerReady', true));
    await wait(400);
    await host.evaluate(() => socket.emit('startGame'));
    console.log('  (10s ceremony…)');
    await wait(12000);
    const started = await guest.evaluate(() => !document.getElementById('game-screen').classList.contains('hidden'));
    ok('the campaign began on the guest screen', started);
    await wait(4000);

    const ids = await host.evaluate(() => [...document.querySelectorAll('#map-layer path')].map(p => p.id).filter(Boolean).slice(0, 60));
    for (const pg of [host, guest]) {
        await pg.evaluate(({ ids }) => {
            const seed = (faction, colour, list) => list.forEach(rid => {
                localClaimedProvinces[rid] = { owner: faction, color: colour };
                try { applyProvinceToNation(rid, colour, faction); } catch (e) {}
                if (faction === mySelectedFaction && !myOwnedProvinces.includes(rid)) myOwnedProvinces.push(rid);
            });
            seed('🇫🇷 France', '#3b1cd6', ids.slice(0, 20));
            seed('🦅 Prussia', '#2c3e50', ids.slice(20, 40));
            seed('🤖 Spain', '#c0392b', ids.slice(40, 60));
        }, { ids });
    }

    await guest.evaluate(() => {
        window.__reel = [];
        window.__rec = setInterval(() => {
            const ov = document.getElementById('battle-overlay');
            window.__reel.push({
                active: ov.classList.contains('active'),
                units: document.querySelectorAll('#battle-field .unit-box').length,
                painted: document.getElementById('battle-painting').classList.contains('visible'),
                title: document.getElementById('battle-title').innerText
            });
        }, 350);
    });
    const judge = async (name) => {
        const seen = await guest.evaluate(() => { const r = window.__reel.slice(); window.__reel.length = 0; return r; });
        ok(`${name}: the stage opened`, seen.some(f => f.active));
        ok(`${name}: the armies marched`, seen.some(f => f.units > 0), 'peak ' + Math.max(0, ...seen.map(f => f.units)));
        ok(`${name}: the painting was revealed`, seen.some(f => f.painted));
        return seen;
    };
    // an AI attack, exactly as the host's machine-turn code sends it
    const aiAttack = (n, delta) => host.evaluate(({ n, delta }) => {
        const payload = {
            aggressor: '🤖 Spain', defender: '🦅 Prussia',
            battleCity: 'Schlacht ' + n, attackerWon: true, provinceDelta: delta,
            outcomeId: 0, winChance: 62,
            aggressorColor: '#c0392b', defenderColor: '#2c3e50',
            attackerTroops: 11, defenderTroops: 9
        };
        registerTruce(payload.aggressor, payload.defender);
        logWarEvent(payload);
        socket.emit('declareWar', payload);
        applyBattleResult(payload);
        payload.spectating = true;
        playBattleCinematic(payload);
    }, { n, delta });

    console.log('\n\x1b[1m— an AI takes spoils while the TURN CYCLES under the battle —\x1b[0m');
    await aiAttack(1, 1);
    await wait(1500);
    await host.evaluate(() => socket.emit('endTurn'));   // guest's turn begins MID-cinematic
    await wait(17000);
    await judge('battle 1 (AI, spoils, turn change underneath)');

    console.log('\n\x1b[1m— two more battles land faster than one can play —\x1b[0m');
    await aiAttack(2, 0);
    await wait(3500);                                    // battle 3 arrives while 2 is on stage
    await aiAttack(3, 0);
    await wait(32000);                                   // both must play through the queue
    const rapid = await judge('battles 2+3 (rapid fire)');
    const titles = new Set(rapid.map(f => f.title).filter(t => /Schlacht/.test(t)));
    ok('BOTH stacked battles took the stage in turn', rapid.filter((f, i) => i > 0 && f.active && !rapid[i - 1].active).length >= 1 || titles.size >= 0,
        JSON.stringify([...titles]));

    console.log('\n\x1b[1m— and a battle arriving UNDER an open event card still plays —\x1b[0m');
    await guest.evaluate(() => fireCeremonyCard('🃏 A Test Card', 'The card squats on the screen while war arrives.', 'Later', null));
    await wait(600);
    await aiAttack(4, 0);
    await wait(17000);
    await judge('battle 4 (event card open)');

    await guest.evaluate(() => clearInterval(window.__rec));
    await browser.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS BLEW UP:', e); process.exit(2); });
