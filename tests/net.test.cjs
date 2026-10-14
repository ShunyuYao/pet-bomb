'use strict';
// LAN room (SPEC §11) over the strict fake host from pet-kit (vendor/pet-kit/testing): one host
// and two guests, each running its own copy of the game with real timers; every human is
// driven by the computer-player brain through the same keyboard-like inputs a person gives.
const test=require('node:test'),assert=require('node:assert/strict');
const {createHub}=require('../vendor/pet-kit/testing/fake-sessions.cjs');
const Net=require('../game/net.js'),Sim=require('../game/sim.cjs'),AI=require('../game/ai.cjs'),Grid=require('../game/grid.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,ms=5000){const until=Date.now()+ms;while(Date.now()<until){if(fn())return;await sleep(30);}throw Error('timeout: '+label);}
const TIMING={playMs:24000,suddenAtMs:8000};
const PROTOCOL={id:'pet-bomb',version:2};

function player(sdk,name,{seed=1,look=null,drive=null}={}){
  const errors=[],feed=[],assets=new Map(),seen=[],hashes={};
  let brain=null,world=null;
  const lan=Net.create(sdk,{strict:true,timing:TIMING,onAsset:(sig,a)=>assets.set(sig,a),onError:e=>errors.push(e.message),
    onFeed:e=>{feed.push(e);const w=lan.game?.world;
      if(e.type==='place'&&w&&e.owner!==lan.mySlot())seen.push(w.t-e.t);
      if(e.type==='end'&&w)hashes[lan.game.round]=Grid.hash(w.cells,w.lying);}});
  const tick=setInterval(()=>{try{
    const w=lan.game?.world;let input={dx:0,dy:0};
    if(w&&drive)input=drive(w,lan)||input;
    else if(w){if(w!==world){world=w;brain=AI.create(1,seed*100+(lan.game.round||0));}const me=Sim.player(w,lan.mySlot());if(me&&me.alive&&w.t>=0)input=AI.input(w,me,brain);}
    lan.step(1000/60,input);
  }catch(e){errors.push(e.stack);}},1000/60);
  return {lan,errors,feed,assets,seen,hashes,name,stop(){clearInterval(tick);lan.dispose();},
    start:()=>lan.start({name,signature:'toy:'+name,kind:'toy'},look)};
}
const pct=(a,q)=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))];};

test('host + 2 guests: lobby → 4 players with a computer → a full match, the same on every screen',{timeout:240000},async()=>{
  const hub=createHub({latency:[5,45],loss:0.03,protocol:PROTOCOL});
  const look=n=>({kind:'toy',species:'cat',color:'#ff8a3d',n});
  const H=player(hub.host(),'房主',{seed:1,look:look(1)}),A=player(hub.guest(),'客人甲',{seed:2,look:look(2)}),B=player(hub.guest(),'客人乙',{seed:3,look:look(3)});
  const all=[H,A,B];
  try{
    for(const p of all)await p.start();
    await waitFor(()=>all.every(p=>p.lan.lobby().players.length===3),'three humans in every lobby');
    await waitFor(()=>A.assets.size===2&&B.assets.size===2&&H.assets.size===2,'looks relayed in the lobby',8000);
    H.lan.setSettings({mode:'ffa',rounds:3});await sleep(400);assert.equal(H.lan.phase(),'lobby','nobody ready → no start');
    for(const p of all)p.lan.setReady(true);
    await waitFor(()=>all.every(p=>['count','play'].includes(p.lan.phase())),'first round on every screen',6000);
    assert.equal(H.lan.game.roster.length,4,'filled to 4');assert.equal(H.lan.game.roster.filter(r=>r.kind==='bot').length,1,'a room of three humans is filled with one computer player');
    const transfers=hub.stats.transfers;
    // Bytes per guest while playing (compressed), sampled every second.
    let maxBytes=0;const sampler=setInterval(()=>{for(const s of [1,2]){const b=H.lan.stats().bySlot[s]?.bytesPerSec||0;if(H.lan.phase()==='play')maxBytes=Math.max(maxBytes,b);}},1000);
    await waitFor(()=>all.every(p=>p.lan.phase()==='results'),'match results everywhere',200000);
    clearInterval(sampler);await sleep(800);
    const r=H.lan.result();assert.ok(r,'host has a result');
    for(const g of [A,B]){assert.deepEqual(g.lan.result(),r,g.name+' agrees on scores and the stats table');}
    for(const no of Object.keys(H.hashes))for(const g of [A,B])assert.equal(g.hashes[no],H.hashes[no],g.name+' ends round '+no+' with the host\'s grid');
    assert.ok(Object.keys(H.hashes).length>=2,'rounds played: '+Object.keys(H.hashes).length);
    const seen=[...A.seen,...B.seen];assert.ok(seen.length>10,'balloons seen: '+seen.length);
    assert.ok(pct(seen,0.95)<=150,'others\' balloons show up within 150 ms (p95 '+pct(seen,0.95)+' ms)');
    assert.ok(maxBytes>0&&maxBytes<=8*1024,'bytes per guest '+maxBytes+' B/s');
    assert.equal(hub.stats.transfers,transfers,'no look transfers during the match');
    assert.equal(hub.stats.backpressure,0,'no send refused by the host');
    for(const p of all)assert.deepEqual(p.errors,[],p.name+' errors');
    console.log('result',JSON.stringify(r.wins),'seen p95',pct(seen,0.95),'bytes/guest',maxBytes,'hub',JSON.stringify({sent:hub.stats.sent,dropped:hub.stats.dropped,resync:hub.stats.resync}));
  }finally{all.forEach(p=>p.stop());}
});

test('state age p95 stays under 150 ms on a 1 Mbps / 100 ms link',{timeout:60000},async()=>{
  const hub=createHub({latency:[45,55],bandwidth:125000,protocol:PROTOCOL});
  const H=player(hub.host(),'房主'),A=player(hub.guest(),'客人甲',{seed:2});
  try{
    await H.start();await A.start();await waitFor(()=>H.lan.lobby().players.length===2,'lobby');
    H.lan.setReady(true);A.lan.setReady(true);
    await waitFor(()=>A.lan.phase()==='play',6000);await sleep(8000);
    const age=A.lan.stats().bySlot[0].stateAgeP95;assert.ok(age<=150,'state age p95 '+age+' ms');
  }finally{H.stop();A.stop();}
});

test('a guest leaving mid-round is taken over by a computer player; the host leaving ends the room',{timeout:60000},async()=>{
  const hub=createHub({latency:[5,30],protocol:PROTOCOL});
  const H=player(hub.host(),'房主'),A=player(hub.guest(),'客人甲',{seed:2}),B=player(hub.guest(),'客人乙',{seed:3});
  try{
    for(const p of [H,A,B])await p.start();await waitFor(()=>H.lan.lobby().players.length===3,'lobby');
    for(const p of [H,A,B])p.lan.setReady(true);
    await waitFor(()=>B.lan.phase()==='play','play',8000);
    const slotA=A.lan.mySlot();await A.lan.leave();
    await waitFor(()=>H.lan.game.roster.find(r=>r.slot===slotA)?.kind==='bot','host: a computer takes the seat',4000);
    await waitFor(()=>B.lan.game.roster.find(r=>r.slot===slotA)?.kind==='bot','guest B sees the takeover',4000);
    assert.ok(['play','round'].includes(H.lan.phase()),'the match continues');
    await H.lan.leave();await waitFor(()=>B.lan.phase()==='closed','the host leaving closes the room',4000);
  }finally{[H,A,B].forEach(p=>p.stop());}
});

test('a guest who holds a needle and presses K is freed on every screen',{timeout:60000},async()=>{
  const hub=createHub({latency:[10,40],protocol:PROTOCOL});
  let pressK=false;
  const H=player(hub.host(),'房主',{drive:()=>({dx:0,dy:0})}),A=player(hub.guest(),'客人甲',{drive:()=>{if(pressK){pressK=false;return {dx:0,dy:0,needle:true};}return {dx:0,dy:0};}});
  try{
    await H.start();await A.start();await waitFor(()=>H.lan.lobby().players.length===2,'lobby');
    H.lan.setReady(true);A.lan.setReady(true);await waitFor(()=>A.lan.phase()==='play','play',8000);
    const slot=A.lan.mySlot(),hw=H.lan.game.world,aw=A.lan.game.world;
    // Preconditions (fixture): the guest holds one needle and sits in a bubble on the host.
    Sim.player(hw,slot).needles=1;Sim.player(aw,slot).needles=1;Sim.trap(hw,Sim.player(hw,slot),0);H.lan.room.emit({type:'trap',slot,by:0,until:Math.round(hw.t+4000),t:Math.round(hw.t)});
    await waitFor(()=>Sim.player(aw,slot).trapped,'the guest sees itself trapped',3000);
    pressK=true;   // the guest's real input: K
    // Judged by the free events (computer players may trap the guest again right after).
    const freed=f=>f.some(e=>e.type==='free'&&e.slot===slot&&e.by==='needle');
    await waitFor(()=>freed(H.feed),'freed on the host',3000);
    await waitFor(()=>freed(A.feed),'freed on the guest',3000);
    assert.equal(Sim.player(hw,slot).needles,0);assert.equal(Sim.player(aw,slot).needles,0,'the needle is used up everywhere');
    assert.ok(Sim.player(hw,slot).alive);
  }finally{H.stop();A.stop();}
});
