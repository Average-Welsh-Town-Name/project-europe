// 🏺 THE MAMLŪKS — the game's second-hardest nation, and the machinery that
// makes them so: an imperiled destiny (Egypt in Turmoil, −20% both ways) and
// the Rise of Muhammad Ali Pasha, which on their 8th turn hands their whole
// Levantine hold to the Ottomans. Plus the map furniture that came with them:
// province 333 is Azerbaijan now, and Tabriz stands in it.
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
            { id: 'ai_1', name: '🤖 The Mamlūks', isHost: false, isAI: true, nation: { name: 'The Mamlūks', color: '#e7e8ac', capital: 'Cairo', flag: '⚔️' } },
            { id: 'ai_2', name: '🤖 The Ottomans', isHost: false, isAI: true, nation: { name: 'The Ottomans', color: '#3dab2e', capital: 'Ankara', flag: '🌙' } },
            { id: 'ai_3', name: '🤖 Serbia', isHost: false, isAI: true, nation: { name: 'Serbia', color: '#273c75', capital: 'Belgrade', flag: '🇷🇸' } }
        ], 'seat_1', false);
        amIHost = true;   // the stub skips the lobby, so claim the host's chair directly
    });
    await p.waitForTimeout(2800);

    console.log('\n\x1b[1m— the beys take their seat at the table —\x1b[0m');
    const shape = await p.evaluate(() => {
        const roster = theaterPresets['Europe'].normal;
        const mam = roster.find(n => n.name === 'The Mamlūks');
        return {
            present: !!mam, color: mam && mam.color,
            egyptGone: !roster.some(n => n.name === 'Egypt'),
            capital: historicalCapitals['The Mamlūks'],
            elevated: ELEVATED_NAMES['The Mamlūks'],
            morocco: ELEVATED_NAMES['Morocco'],
            byzBan: FORMABLE_BANS['Byzantine Empire'].includes('The Mamlūks'),
            hispBan: FORMABLE_BANS['Hispania'].includes('The Mamlūks'),
            flag: flagSrcOf('⚔️ The Mamlūks'),
            azerbaijan: PROVINCE_NAMES['region-333'],
            tabriz: (cityData.find(c => c.name === 'Tabriz') || null)
        };
    });
    ok('The Mamlūks are a preset nation', shape.present === true);
    ok('in the colour asked for', shape.color === '#e7e8ac', String(shape.color));
    ok('and Egypt is gone from the roster — they ARE Egypt now', shape.egyptGone === true);
    ok('their capital is Cairo', shape.capital === 'Cairo', String(shape.capital));
    ok('at 100 power they elevate to the MAMLŪK SULTANATE', shape.elevated === 'Mamlūk Sultanate', String(shape.elevated));
    ok('…and Morocco now elevates to the MOROCCAN SULTANATE', shape.morocco === 'Moroccan Sultanate', String(shape.morocco));
    ok('they can never proclaim Byzantium', shape.byzBan === true);
    ok('nor Hispania', shape.hispBan === true);
    ok('they fly the player-supplied Mamlūk banner', shape.flag === 'art/mamlukflag.jpg', String(shape.flag));
    ok('province 333 is called AZERBAIJAN now', shape.azerbaijan === 'Azerbaijan', String(shape.azerbaijan));
    ok('and Tabriz stands in it', !!shape.tabriz && shape.tabriz.x === 1701 && shape.tabriz.y === 960, JSON.stringify(shape.tabriz));

    console.log('\n\x1b[1m— 🏺 Egypt in Turmoil: an IMPERILED destiny —\x1b[0m');
    const doom = await p.evaluate(() => {
        const t = traitEffects('🤖 The Mamlūks');
        return { off: t.offenseMult, def: t.defenseMult, title: t.title, art: t.art };
    });
    ok('the title is Egypt in Turmoil', /Egypt in Turmoil/.test(doom.title || ''), String(doom.title));
    ok('−20% on the attack', doom.off === 0.8, String(doom.off));
    ok('−20% on the defence', doom.def === 0.8, String(doom.def));
    ok('with art waiting for it', doom.art === 'art/egyptinturmoil.jpg', String(doom.art));

    const scales = await p.evaluate(() => {
        const ids = [...document.querySelectorAll('#map-layer path')].map(x => x.id).filter(Boolean);
        const paint = (f, c, list) => list.forEach(r => { localClaimedProvinces[r] = { owner: f, color: c }; applyProvinceToNation(r, c, f); });
        paint('🤖 The Mamlūks', '#e7e8ac', ids.slice(0, 15));
        paint('🤖 Serbia', '#273c75', ids.slice(15, 30));
        paint('🤖 The Ottomans', '#3dab2e', ids.slice(30, 45));
        return {
            mamluk: computeWinChance('🤖 The Mamlūks', '🤖 The Ottomans'),
            serb: computeWinChance('🤖 Serbia', '🤖 The Ottomans')
        };
    });
    ok('with equal armies, the Mamlūks attack WORSE than an untroubled nation',
        scales.mamluk < scales.serb, `Mamlūks ${scales.mamluk} vs Serbia ${scales.serb}`);

    console.log('\n\x1b[1m— 🏺 the Rise of Muhammad Ali Pasha —\x1b[0m');
    const DOOMED = ['region-133','region-288','region-287','region-24','region-109','region-289','region-22','region-286','region-73','region-156','region-333'];
    const skipped = await p.evaluate((DOOMED) => {
        const paint = (f, c, list) => list.forEach(r => { localClaimedProvinces[r] = { owner: f, color: c }; applyProvinceToNation(r, c, f); });
        paint('🤖 The Mamlūks', '#e7e8ac', DOOMED.concat(['region-89', 'region-23']));  // the Levante AND home
        eliminatedNations.add('🤖 The Ottomans');
        mamlukTurns = MAMLUK_COLLAPSE_DUE - 1; mamlukCollapseDone = false;
        maybeTriggerMamlukCollapse('🤖 The Mamlūks');   // the fated turn strikes
        const kept = DOOMED.every(r => localClaimedProvinces[r].owner === '🤖 The Mamlūks');
        const out = { kept, done: mamlukCollapseDone, log: document.getElementById('event-log-body').innerText };
        eliminatedNations.delete('🤖 The Ottomans');    // the Porte returns for the next act
        return out;
    }, DOOMED);
    ok('with no Ottoman crown alive, the beys keep the Levante', skipped.kept === true);
    ok('and the clock still closes — the hour comes ONCE', skipped.done === true);
    ok('the chronicle says why', /no Sultan to serve|no Ottoman crown/i.test(skipped.log));

    const rise = await p.evaluate((DOOMED) => {
        mamlukTurns = 0; mamlukCollapseDone = false;
        const before = { turns: [] };
        // every turn but the last passes — and other nations' turns must not count
        for (let i = 0; i < MAMLUK_COLLAPSE_DUE - 1; i++) {
            maybeTriggerMamlukCollapse('🤖 The Mamlūks');
            maybeTriggerMamlukCollapse('🇫🇷 France');
            maybeTriggerMamlukCollapse('🤖 Serbia');
        }
        before.at13 = mamlukTurns;
        before.due = MAMLUK_COLLAPSE_DUE;
        before.stillTheirs = DOOMED.every(r => localClaimedProvinces[r].owner === '🤖 The Mamlūks');
        // the fated turn
        maybeTriggerMamlukCollapse('🤖 The Mamlūks');
        const after = {
            taken: DOOMED.filter(r => localClaimedProvinces[r].owner === '🤖 The Ottomans').length,
            cairoKept: localClaimedProvinces['region-89'].owner === '🤖 The Mamlūks' &&
                       localClaimedProvinces['region-23'].owner === '🤖 The Mamlūks',
            done: mamlukCollapseDone,
            log: document.getElementById('event-log-body').innerText
        };
        localClaimedProvinces['region-133'] = { owner: '🤖 The Mamlūks', color: '#e7e8ac' };
        for (let i = 0; i < 20; i++) maybeTriggerMamlukCollapse('🤖 The Mamlūks');
        after.neverTwice = localClaimedProvinces['region-133'].owner === '🤖 The Mamlūks';
        return Object.assign(before, after);
    }, DOOMED);
    ok('the fated turn is the EIGHTH — 14 was much too late', rise.due === 8, String(rise.due));
    ok('seven Mamlūk turns pass and nothing stirs', rise.at13 === rise.due - 1 && rise.stillTheirs === true, `turns ${rise.at13}`);
    ok('other nations\' turns never advance their clock', rise.at13 === rise.due - 1);
    ok('on the EIGHTH, the whole Levantine hold passes to the Ottomans',
        rise.taken === DOOMED.length, `${rise.taken}/${DOOMED.length}`);
    ok('but Cairo and the Nile stay Mamlūk — the Pasha rules, the map keeps them', rise.cairoKept === true);
    ok('the chronicle announces the Rise', /RISE OF MUHAMMAD ALI PASHA/i.test(rise.log));
    ok('and the hour never strikes twice', rise.neverTwice === true);

    console.log('\n\x1b[1m— the Sultanate, when it is earned —\x1b[0m');
    const sultanate = await p.evaluate(() => {
        const ids = [...document.querySelectorAll('#map-layer path')].map(x => x.id).filter(Boolean);
        ids.slice(45, 160).forEach(r => {
            if (!localClaimedProvinces[r]) { localClaimedProvinces[r] = { owner: '🤖 The Mamlūks', color: '#e7e8ac' }; applyProvinceToNation(r, '#e7e8ac', '🤖 The Mamlūks'); }
        });
        return { power: getNationPower('🤖 The Mamlūks'), title: displayTitleOf('🤖 The Mamlūks') };
    });
    ok('a hundred-power Mamlūk state is the MAMLŪK SULTANATE',
        sultanate.power < 100 || sultanate.title === 'Mamlūk Sultanate',
        `power ${sultanate.power} → ${sultanate.title}`);
    ok('and the power really was earned for the check to mean anything', sultanate.power >= 100, String(sultanate.power));

    ok('no page errors through the whole run', errs.length === 0, errs.join(' | '));
    await b.close();
    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BLEW UP', e); process.exit(2); });
