// 👁 THE SPECTATOR'S CURTAIN-RAISER — a host with no crown of their own must
// still be able to begin an all-AI campaign (that IS the simulation), and a
// refusal the server sends to the lobby must be VISIBLE, not logged to a
// chronicle nobody can see. Built to the report: "I click spectate and begin
// campaign… it doesn't do anything."
// Runs against the REAL server:  PORT=3200 node server.js
const { chromium } = require('playwright-core');
const URL = 'http://localhost:' + (process.env.RELAY_PORT || '3200') + '/index.html';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => {
    if (c) { pass++; console.log(`  \x1b[32m✔\x1b[0m ${n}`); }
    else { fail++; console.log(`  \x1b[31m✘ ${n}\x1b[0m${e ? '  → ' + e : ''}`); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', e => { if (!/Panzoom/.test(e.message)) errs.push(e.message); });
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(700);

    console.log('\n\x1b[1m— a spectator host opens a chamber —\x1b[0m');
    await p.evaluate(() => { document.getElementById('username').value = 'Watcher'; doCreate(); });
    await wait(700);
    const code = await p.evaluate(() => (document.getElementById('display-code').innerText || '').trim());
    ok('a chamber opened', /^[A-Z]{4}$/.test(code), code);
    await p.evaluate(() => chooseSpectator());
    await wait(400);

    console.log('\n\x1b[1m— with NOBODY on the map, the refusal is VISIBLE —\x1b[0m');
    await p.evaluate(() => hostSignalsStart());
    await wait(700);
    const refusal = await p.evaluate(() => {
        const el = document.getElementById('lobby-notice');
        return { shown: !!el && el.style.display !== 'none', text: el ? el.textContent : '' };
    });
    ok('the lobby says WHY nothing happened', refusal.shown === true, JSON.stringify(refusal));
    ok('and says what to do about it', /nation|AI/i.test(refusal.text), refusal.text);
    const notStarted = await p.evaluate(() => document.getElementById('game-screen').classList.contains('hidden'));
    ok('and the campaign rightly did not begin', notStarted === true);

    console.log('\n\x1b[1m— add machine crowns, and the curtain rises —\x1b[0m');
    await p.evaluate(() => {
        socket.emit('addAI', { nation: { name: 'France', color: '#3b1cd6', flag: '🇫🇷', capital: 'Paris' } });
        socket.emit('addAI', { nation: { name: 'The Mamlūks', color: '#e7e8ac', flag: '⚔️', capital: 'Cairo' } });
    });
    await wait(500);
    const seats = await p.evaluate(() => (lastRoster || []).map(x => x.name));
    ok('two AI sovereigns are seated', seats.filter(n => /🤖/.test(n)).length === 2, JSON.stringify(seats));

    await p.evaluate(() => hostSignalsStart());
    console.log('  (3s solo-host ceremony…)');
    await wait(6000);
    const started = await p.evaluate(() => ({
        game: !document.getElementById('game-screen').classList.contains('hidden'),
        observer: mySelectedFaction === 'Observer Mode'
    }));
    ok('the all-AI campaign BEGINS for the spectator', started.game === true);
    ok('who is still the observer, not a combatant', started.observer === true);

    await wait(3000); // let the first AI turn get moving
    const world = await p.evaluate(() => ({
        banner: document.getElementById('turn-status-banner').innerText,
        provinces: Object.keys(localClaimedProvinces).length
    }));
    ok('the machines are actually playing', world.provinces > 0 || /Turn|Spectat/i.test(world.banner),
        JSON.stringify(world));

    ok('no page errors through the whole run', errs.length === 0, errs.join(' | '));
    await b.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BLEW UP', e); process.exit(2); });
