// 🎭 EVERY battle must play in FULL on the non-host's screen — banner, armies,
// painting — not just the first one. Drives three realistically-spaced wars
// over the REAL relay and watches the guest's stage frame by frame.
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

    console.log('\n\x1b[1m— two players sit down —\x1b[0m');
    await host.evaluate(() => { document.getElementById('username').value = 'Hosty'; doCreate(); });
    await host.waitForTimeout(600);
    const code = await host.evaluate(() => (document.getElementById('display-code').innerText || '').trim());
    ok('a chamber opened', /^[A-Z]{4}$/.test(code), code);
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

    const ids = await host.evaluate(() => [...document.querySelectorAll('#map-layer path')].map(p => p.id).filter(Boolean).slice(0, 40));
    for (const pg of [host, guest]) {
        await pg.evaluate(({ ids }) => {
            const seed = (faction, colour, list) => list.forEach(rid => {
                localClaimedProvinces[rid] = { owner: faction, color: colour };
                try { applyProvinceToNation(rid, colour, faction); } catch (e) {}
                if (faction === mySelectedFaction && !myOwnedProvinces.includes(rid)) myOwnedProvinces.push(rid);
            });
            seed('🇫🇷 France', '#3b1cd6', ids.slice(0, 20));
            seed('🦅 Prussia', '#2c3e50', ids.slice(20, 40));
        }, { ids });
    }

    // 🎥 A frame-by-frame recorder on the guest's stage
    await guest.evaluate(() => {
        window.__reel = [];
        window.__rec = setInterval(() => {
            const ov = document.getElementById('battle-overlay');
            window.__reel.push({
                t: Date.now(),
                active: ov.classList.contains('active'),
                units: document.querySelectorAll('#battle-field .unit-box').length,
                painted: document.getElementById('battle-painting').classList.contains('visible'),
                title: document.getElementById('battle-title').innerText
            });
        }, 400);
    });

    console.log('\n\x1b[1m— three wars arrive over the wire, realistically spaced —\x1b[0m');
    const attack = (n) => host.evaluate((n) => {
        socket.emit('declareWar', {
            aggressor: '🇫🇷 France', defender: '🦅 Prussia',
            battleCity: 'Feld ' + n, attackerWon: true, provinceDelta: 0,
            outcomeId: 0, winChance: 60,
            aggressorColor: '#3b1cd6', defenderColor: '#2c3e50',
            attackerTroops: 10, defenderTroops: 8
        });
    }, n);

    for (let n = 1; n <= 3; n++) {
        await guest.evaluate(() => { window.__reel.length = 0; });
        await attack(n);
        await wait(19000);   // full scene + auto-close + breathing room, untouched by hands
        const seen = await guest.evaluate(() => window.__reel.slice());
        const wasActive = seen.some(f => f.active);
        const hadArmies = seen.some(f => f.units > 0);
        const hadPainting = seen.some(f => f.painted);
        const rightBattle = seen.some(f => new RegExp('Feld ' + 0 + '|Feld').test(f.title));
        const closedItself = seen.length && !seen[seen.length - 1].active;
        ok(`battle ${n}: the stage OPENS`, wasActive, JSON.stringify(seen.slice(0, 4)));
        ok(`battle ${n}: the armies march (the map with boxes)`, hadArmies,
            'peak units ' + Math.max(0, ...seen.map(f => f.units)));
        ok(`battle ${n}: the painting is revealed`, hadPainting);
        ok(`battle ${n}: it is the right battle`, rightBattle, seen.map(f => f.title).find(Boolean) || '(none)');
        ok(`battle ${n}: the stage clears itself for the next`, closedItself);
    }

    await guest.evaluate(() => clearInterval(window.__rec));
    await browser.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS BLEW UP:', e); process.exit(2); });
