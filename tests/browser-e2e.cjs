'use strict';
// Plain-browser acceptance (SPEC §2–§4, §7, §10): the unmodified built HTML in a hidden Chromium
// window, driven only by real CDP input — keyboard for menus, walking, balloons and the needle,
// the real file chooser for 2D / 3D imports. Checks read what the game shows or the read-only
// state hook (window.__bomb).
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {launch,ROOT}=require('./launch.cjs');
const DOLL=process.env.BOMB_DOLL_ZIP||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-female.zip');
const IMAGE=process.env.BOMB_IMAGE||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-male/frames/idle/frame_00.png');
const out=path.join(ROOT,'artifacts/browser-e2e');fs.mkdirSync(out,{recursive:true});
const check=(ok,label,detail)=>{assert.ok(ok,label+(detail!==undefined?' '+JSON.stringify(detail):''));console.log('PASS',label);};
(async()=>{
  assert(fs.existsSync(DOLL)&&fs.existsSync(IMAGE),'local character fixtures missing');
  const {p,wait,errors,close,sleep}=await launch();
  const st=()=>p.evaluate('window.__bomb.state()'),me=async()=>(await st()).me,shot=n=>p.screenshot(path.join(out,n+'.png'));
  try{
    await wait('window.__bomb?.state().driver','boot');
    check(await p.evaluate('typeof window.pet==="undefined"'),'plain browser: no pet SDK');
    check((await st()).driver.kind==='toy','default look is a built-in toy');
    await p.setFiles('#import-file',[IMAGE]);await wait('window.__bomb.state().driver.kind==="sprite"','2D import');
    await wait('window.__bomb.world().players.find(x=>x.slot===0)?.kind==="sprite"','2D standee built');check(true,'a picture becomes a 2D standee');
    await p.setFiles('#import-file',[DOLL]);await wait('window.__bomb.state().driver.kind==="doll3d"','3D import',60000);
    await wait('window.__bomb.world().players.find(x=>x.slot===0)?.kind==="doll3d"','3D doll built',30000);check(true,'a doll pack becomes a 3D doll');
    await shot('01-title');
    // Options by keyboard: free-for-all, 2 players, 3 rounds, easy computer.
    await p.activate('.mode-card[data-mode="ffa"]');await p.activate('#size-list [data-value="2"]');await p.activate('#rounds-list [data-value="3"]');await p.activate('#cpu-list [data-value="0"]');
    await p.activate('#solo');
    await wait('window.__bomb.state().phase==="count"','countdown');
    check((await st()).players.length===2,'2 players: one computer opponent');
    const x0=(await me()).x;await p.key('KeyD');await sleep(500);await p.key('KeyD','keyUp');
    check((await me()).x===x0,'the countdown freezes movement');
    await wait('window.__bomb.state().phase==="play"','play',6000);
    // From the spawn corner (1,1): its right and lower neighbours are always free (SPEC §1).
    // Last pressed direction wins: hold D, then also S → turns down (sliding into the lane).
    const y0=(await me()).y;
    await p.key('KeyD');await sleep(80);await p.key('KeyS');await sleep(300);await p.key('KeyS','keyUp');await p.key('KeyD','keyUp');
    const m2=await me();check(m2.y>y0+0.4,'the most recent direction wins',{y0,y1:m2.y});
    await p.key('KeyW');await sleep(400);await p.key('KeyW','keyUp');
    const xa=(await me()).x;await p.key('KeyD');await sleep(220);await p.key('KeyD','keyUp');
    const m1=await me();check(m1.x>xa+0.6,'D walks right',{from:xa,to:m1.x});
    // Space places a balloon on my cell; standing on it, the splash traps me.
    await sleep(300);const cell=[Math.round((await me()).x),Math.round((await me()).y)];
    await p.press('Space');await sleep(150);
    const b=(await st()).balloons.find(x=>x.owner===0);check(b&&b.x===cell[0]&&b.y===cell[1],'space places a balloon',{b,cell});
    await wait('window.__bomb.state().me.trapped','trapped by my own splash',4000);
    await wait('window.__bomb.world().players.find(x=>x.slot===0)?.bubble','bubble drawn',2000);check(true,'a trapped player is drawn inside a bubble');
    await shot('02-trapped');
    await p.press('KeyK');await sleep(200);check((await me()).trapped,'K without a needle leaves you trapped');
    check(await p.evaluate('/被困/.test(document.querySelector("#side-l [data-slot=\\"0\\"] .state")?.textContent||"")'),'my card shows the bubble countdown');
    // The timer pops me → the computer wins the round → round screen.
    await wait('window.__bomb.state().phase==="round"','round result',8000);
    await wait('!document.querySelector("#round-panel").hidden&&/回合/.test(document.querySelector("#round-title").textContent)','round panel',2000);check(true,'the round result is shown');
    await shot('03-round');
    // Round 2: same again → the computer takes the match 2:0.
    await wait('window.__bomb.state().phase==="play"&&window.__bomb.state().round===2','round 2',8000);
    await p.press('Space');await wait('window.__bomb.state().phase==="results"','match results',15000);
    await sleep(400);const r=(await st()).result;
    check(r&&r.winner==='s1'&&r.wins.s1===2,'first to 2 round wins takes the match',r);
    await wait('!document.querySelector("#results-panel").hidden&&/赢/.test(document.querySelector("#results-title").textContent)','results panel',2000);check(true,'results panel shows the outcome');
    check(await p.evaluate('document.querySelectorAll("#results-stats tr").length===3'),'the stats table lists both players');
    await shot('04-results');
    await p.activate('#again');await wait('window.__bomb.state().phase==="count"','rematch');check(true,'rematch from the results panel');
    await p.activate('#leave');await wait('window.__bomb.state().mode==="title"','back to title');check(true,'leave returns to the title');
    assert.deepEqual(errors,[],'no page errors');check(true,'no page errors or exceptions');
  }finally{close();}
})().catch(e=>{console.error(e);process.exit(1);});
