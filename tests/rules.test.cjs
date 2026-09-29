'use strict';
// Rules (SPEC §1–§8), driven through the simulation's public inputs: movement keys, the place
// key, the needle key, and time. Names match the → markers in docs/SPEC.zh-CN.md.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/config.cjs'),Grid=require('../game/grid.cjs'),Sim=require('../game/sim.cjs'),Match=require('../game/match.cjs');
const {W,H,CELL}=C,idx=Grid.idx,DT=1000/60;

// Slot 1 (bottom-right corner) is in every default world so a round never ends by itself.
function world({mode='ffa',items='advanced',seed=5,slots=[0,1],open=true,t=0}={}){
  const w=Sim.createWorld({seed,items,mode,roster:slots.map(slot=>({slot}))});
  if(open)for(let i=0;i<w.cells.length;i++)if(w.cells[i]===CELL.crate){w.cells[i]=CELL.floor;w.hidden[i]=-1;}
  w.t=t;return w;
}
function run(w,ms,inputs={},each){const events=[];const n=Math.round(ms/DT);for(let k=0;k<n;k++){const i=typeof inputs==='function'?inputs(k):inputs;events.push(...Sim.step(w,DT,i));each&&each(k);}return events;}
const P=(w,s)=>Sim.player(w,s);
const at=(p,x,y)=>{p.x=x;p.y=y;};
const press=(w,slot,extra={})=>Sim.step(w,DT,{[slot]:{dx:0,dy:0,place:true,...extra}});

test('map is 15×13 with walls on the border and furniture on even/even cells',()=>{
  const {cells}=Grid.build(42);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const c=cells[idx(x,y)],border=x===0||y===0||x===W-1||y===H-1;
    if(border)assert.equal(c,CELL.wall,`wall at ${x},${y}`);
    else if(x%2===0&&y%2===0)assert.equal(c,CELL.furniture,`furniture at ${x},${y}`);
    else assert.ok(c===CELL.floor||c===CELL.crate);
  }
});

test('every spawn corner keeps an L of three free cells',()=>{
  for(let seed=1;seed<60;seed++){const {cells}=Grid.build(seed);for(const i of Grid.safeCells())assert.equal(cells[i],CELL.floor,'seed '+seed);}
});

test('the same seed builds the same map and hidden items',()=>{
  const a=Grid.build(99),b=Grid.build(99),c=Grid.build(100);
  assert.deepEqual([...a.cells],[...b.cells]);assert.deepEqual([...a.hidden],[...b.hidden]);
  assert.notDeepEqual([...a.cells],[...c.cells]);
  // ≈ 60 % crates on free cells, ≈ 35 % of crates hide an item
  let free=0,crates=0,items=0;
  for(let seed=1;seed<200;seed++){const m=Grid.build(seed);for(let i=0;i<m.cells.length;i++){if(m.cells[i]===CELL.floor||m.cells[i]===CELL.crate)free++;if(m.cells[i]===CELL.crate){crates++;if(m.hidden[i]>=0)items++;}}}
  assert.ok(Math.abs(crates/free-0.6*(1-12/free*199))<0.06,'crate share '+(crates/free).toFixed(3));
  assert.ok(Math.abs(items/crates-0.35)<0.03,'item share '+(items/crates).toFixed(3));
});

test('hidden items follow the mode (no kick or needle in standard)',()=>{
  const seen=mode=>{const s=new Set();for(let seed=1;seed<120;seed++){const m=Grid.build(seed,{items:mode});for(const h of m.hidden)if(h>=0)s.add(C.ITEMS[h]);}return s;};
  assert.deepEqual([...seen('standard')].sort(),['bomb','fire','shoe']);
  assert.deepEqual([...seen('advanced')].sort(),['bomb','fire','kick','needle','shoe']);
});

test('speed starts at 4 cells/s and shoes add 0.6 up to 7',()=>{
  const w=world();const p=P(w,0);at(p,1,1);
  run(w,500,{0:{dx:1,dy:0}});assert.ok(Math.abs(p.x-3)<0.05,'4 cells/s → 2 cells in 0.5 s: '+p.x);
  p.shoes=2;at(p,1,1);run(w,500,{0:{dx:1,dy:0}});assert.ok(Math.abs(p.x-(1+5.2*0.5))<0.05,'two shoes → 5.2 cells/s: '+p.x);
  p.shoes=0;for(let i=0;i<9;i++){w.lying[idx(3,3)]=C.ITEMS.indexOf('shoe');at(p,3,3);run(w,DT);}
  assert.equal(Sim.speedOf(p),7,'nine shoes cap at 7');
});

test('walls, furniture, crates and balloons block; players pass through each other',()=>{
  const w=world({slots:[0,2]});const p=P(w,0),q=P(w,2);
  at(p,1,1);run(w,600,{0:{dx:-1,dy:0}});assert.ok(Math.abs(p.x-1)<0.02,'border wall: '+p.x);
  at(p,1,1);run(w,600,{0:{dx:0,dy:1}});at(p,1,3);run(w,600,{0:{dx:1,dy:0}});assert.ok(p.x>2.9,'row 3 is open');
  at(p,3,1);run(w,600,{0:{dx:0,dy:1}});assert.ok(Math.abs(p.y-3)<0.02||p.y>2.9,'column 3 is open');
  at(p,1,2);run(w,600,{0:{dx:1,dy:0}});assert.ok(Math.abs(p.x-1)<0.02,'furniture at (2,2) blocks: '+p.x);
  w.cells[idx(3,1)]=CELL.crate;at(p,1,1);run(w,600,{0:{dx:1,dy:0}});assert.ok(Math.abs(p.x-2)<0.02,'crate at (3,1) stops at (2,1): '+p.x);
  w.cells[idx(3,1)]=CELL.floor;
  at(q,5,1);Sim.place(w,q);at(q,9,9);at(p,3,1);run(w,600,{0:{dx:1,dy:0}});assert.ok(Math.abs(p.x-4)<0.02,'balloon at (5,1) stops at (4,1): '+p.x);
  w.balloons=[];at(q,5,1);at(p,3,1);run(w,800,{0:{dx:1,dy:0}});assert.ok(p.x>5.5,'players pass through each other: '+p.x);
});

test('turning near a corner slides into the lane',()=>{
  const w=world();const p=P(w,0);
  at(p,1,1.3);run(w,400,{0:{dx:1,dy:0}});
  assert.ok(Math.abs(p.y-1)<0.01,'slid into lane y=1: '+p.y);assert.ok(p.x>1.8,'and kept going: '+p.x);
  at(p,1,1.45);const y0=p.y;run(w,300,{0:{dx:1,dy:0}});assert.equal(p.y,y0,'too far from the lane (0.45 > 0.4): no slide');
});

test('J places a balloon on the player\'s cell up to the capacity',()=>{
  const w=world();const p=P(w,0);at(p,3,1);
  press(w,0);assert.equal(w.balloons.length,1);assert.deepEqual([w.balloons[0].x,w.balloons[0].y],[3,1]);
  at(p,5,1);press(w,0);assert.equal(w.balloons.length,1,'capacity 1');
  p.bombs=2;press(w,0);assert.equal(w.balloons.length,2);
  press(w,0);assert.equal(w.balloons.length,2,'never two balloons on one cell');
});

test('a balloon bursts after 2.5 s into a cross as long as the fire range',()=>{
  const w=world();const p=P(w,0);at(p,5,1);p.fire=3;press(w,0);at(p,11,11);
  run(w,2450);assert.equal(w.balloons.length,1,'not yet at 2.45 s');
  const ev=run(w,100).filter(e=>e.type==='burst');assert.equal(ev.length,1,'burst by 2.55 s');
  const cells=ev[0].cells.map(i=>[i%W,Math.floor(i/W)]).sort().join(' ');
  assert.equal(cells,[[2,1],[3,1],[4,1],[5,1],[5,2],[5,3],[5,4],[6,1],[7,1],[8,1]].sort().join(' '),'3 each way; up is the wall');
});

test('splash stops at furniture and at the first crate; revealed items survive, lying items are washed away',()=>{
  const w=world();const p=P(w,0);p.fire=4;at(p,3,3);
  w.cells[idx(5,3)]=CELL.crate;w.hidden[idx(5,3)]=C.ITEMS.indexOf('fire');w.cells[idx(6,3)]=CELL.crate;
  w.lying[idx(3,5)]=C.ITEMS.indexOf('bomb');
  press(w,0);at(p,11,11);const ev=run(w,2600).find(e=>e.type==='burst');
  const has=(x,y)=>ev.cells.includes(idx(x,y));
  assert.ok(has(5,3)&&!has(6,3),'stops at the first crate (5,3), the one behind stays');
  assert.equal(w.cells[idx(6,3)],CELL.crate);assert.equal(w.lying[idx(5,3)],C.ITEMS.indexOf('fire'),'revealed item survives');
  assert.equal(w.lying[idx(3,5)],-1,'lying item washed');assert.ok(has(3,7),'splash continues past the washed item');
  assert.ok(!has(2,2)&&!has(3,0),'furniture and walls stop it');
});

test('splash sets off other balloons at once (chain)',()=>{
  const w=world({slots:[0,2]});const p=P(w,0),q=P(w,2);at(p,3,1);press(w,0);at(p,11,11);
  run(w,1500);at(q,5,1);q.fire=1;press(w,2);at(q,11,9);
  const ev=run(w,1100).filter(e=>e.type==='burst');
  assert.equal(ev.length,1,'one burst event carries the chain');assert.equal(ev[0].ids.length,2);
  assert.ok(ev[0].cells.includes(idx(6,1)),'the second balloon\'s own cross is included');
  assert.equal(w.balloons.length,0);
});

test('you can walk off a balloon you just placed but not back onto it',()=>{
  const w=world();const p=P(w,0);at(p,3,1);press(w,0);
  run(w,400,{0:{dx:1,dy:0}});assert.ok(p.x>4,'walked off: '+p.x);
  run(w,600,{0:{dx:-1,dy:0}});assert.ok(Math.abs(p.x-4)<0.02,'cannot walk back onto it: '+p.x);
});

test('splash traps a player in a bubble for 4 s at 1 cell/s',()=>{
  const w=world({slots:[0,2]});const p=P(w,0),q=P(w,2);at(p,3,1);press(w,0);at(p,11,11);at(q,5,1);
  run(w,2600);assert.ok(q.trapped,'trapped');assert.equal(q.trapped.by,0);assert.equal(P(w,0).stats.traps,1);
  const x0=q.x;run(w,500,{2:{dx:1,dy:0}});assert.ok(Math.abs(q.x-x0-0.5)<0.03,'1 cell/s: '+(q.x-x0));
  q.bombs=3;press(w,2);assert.equal(w.balloons.length,0,'no balloons from inside a bubble');
  run(w,3600);assert.equal(q.alive,false,'the timer pops it after 4 s');
});

test('a teammate\'s touch frees, an opponent\'s touch pops, the timer pops',()=>{
  // team mode: slots 0 and 3 are orange (left corners), 1 and 2 blue
  const mk=()=>{const w=world({mode:'team',slots:[0,1,2,3]});for(const s of [0,1,2,3])at(P(w,s),11,s%2?9:11);return w;};
  let w=mk();at(P(w,0),5,5);Sim.trap(w,P(w,0),1);at(P(w,3),5.5,5);run(w,DT);
  assert.equal(P(w,0).trapped,null,'teammate frees');assert.equal(P(w,3).stats.rescues,1);
  const ev=run(w,DT);assert.ok(P(w,0).invulnUntil>w.t,'1 s of protection');
  w=mk();at(P(w,0),5,5);Sim.trap(w,P(w,0),1);at(P(w,2),5.5,5);run(w,DT);
  assert.equal(P(w,0).alive,false,'opponent pops');assert.equal(P(w,2).stats.pops,1);
  w=mk();at(P(w,0),5,5);Sim.trap(w,P(w,0),1);at(P(w,3),6,5);run(w,DT);assert.ok(P(w,0).trapped,'0.8 cells is not a touch');
});

test('in free-for-all any touch pops',()=>{
  const w=world({mode:'ffa',slots:[0,3]});at(P(w,0),5,5);at(P(w,3),9,9);Sim.trap(w,P(w,0),1);at(P(w,3),5.4,5);run(w,DT);
  assert.equal(P(w,0).alive,false);
});

test('K uses a needle to get out of a bubble',()=>{
  const w=world({slots:[0,1]});const p=P(w,0);at(p,5,5);
  Sim.trap(w,p,1);Sim.step(w,DT,{0:{dx:0,dy:0,needle:true}});assert.ok(p.trapped,'no needle: nothing happens');
  p.needles=1;Sim.step(w,DT,{0:{dx:0,dy:0,needle:true}});assert.equal(p.trapped,null,'needle frees');assert.equal(p.needles,0);
  assert.ok(p.invulnUntil>w.t);
});

test('items apply their effect and respect their caps',()=>{
  const w=world();const p=P(w,0);const drop=name=>{w.lying[idx(3,3)]=C.ITEMS.indexOf(name);at(p,3,3);run(w,DT);};
  for(let i=0;i<9;i++)drop('bomb');assert.equal(p.bombs,8);
  for(let i=0;i<9;i++)drop('fire');assert.equal(p.fire,8);
  drop('kick');assert.equal(p.kick,true);
  drop('needle');assert.equal(p.needles,1);drop('needle');assert.equal(p.needles,1,'a second needle is not picked up');
  assert.equal(w.lying[idx(3,3)],C.ITEMS.indexOf('needle'),'it stays on the floor');
});

test('a kicked balloon slides at 8 cells/s until blocked (items do not block), its fuse keeps running',()=>{
  const w=world({slots:[0,2]});const p=P(w,0),q=P(w,2);at(q,5,1);Sim.place(w,q);at(q,11,11);
  w.lying[idx(7,1)]=C.ITEMS.indexOf('fire');w.cells[idx(11,1)]=CELL.crate;
  p.kick=true;at(p,3,1);const fuse=w.balloons[0].explodeAt;
  run(w,300,{0:{dx:1,dy:0}});const b=w.balloons[0];assert.ok(b.slide||b.x>5,'kicked');
  run(w,900);assert.deepEqual([b.x,b.y],[10,1],'stops before the crate at (11,1), passing over the item');
  assert.equal(w.lying[idx(7,1)],C.ITEMS.indexOf('fire'),'the item is still there');
  assert.equal(b.explodeAt,fuse,'fuse unchanged');
  // a player in the way stops it
  const w2=world({slots:[0,2]});const a=P(w2,0),c=P(w2,2);at(c,5,1);Sim.place(w2,c);at(c,8,1);a.kick=true;at(a,3,1);
  run(w2,600,{0:{dx:1,dy:0}});assert.deepEqual([w2.balloons[0].x,w2.balloons[0].y],[7,1],'stops before the player at (8,1)');
});

test('a sliding balloon hit by splash bursts',()=>{
  const w=world({slots:[0,2]});const q=P(w,2);q.bombs=2;q.fire=4;
  at(q,9,3);Sim.place(w,q);                 // bursts at 2.5 s over row 3, x 5…13
  at(q,5,1);Sim.place(w,q);at(q,11,11);
  run(w,2400);
  const b=w.balloons.find(b=>b.x===5);b.slide={dx:0,dy:1};b.off=0;   // kicked down column 5, reaches (5,3) at ≈2.65 s
  const ev=run(w,500).filter(e=>e.type==='burst');
  assert.ok(ev.some(e=>e.ids.includes(b.id)),'set off inside the splash');
  assert.ok(!w.balloons.includes(b));
});

test('countdown freezes players',()=>{
  const w=world({t:-3000});const p=P(w,0);at(p,1,1);run(w,2000,{0:{dx:1,dy:0}});assert.equal(p.x,1);
  run(w,1500,{0:{dx:1,dy:0}});assert.ok(p.x>1,'moves once play starts');
});

test('the last 30 s drops books along the two outer rings; a book knocks out whoever stands there',()=>{
  const w=world({slots:[0,1,2]});const books=Grid.bookOrder();
  assert.equal(books.length,new Set(books.map(String)).size);assert.ok(books.every(([x,y])=>x>=1&&y>=1&&x<=W-2&&y<=H-2&&!(x%2===0&&y%2===0)));
  at(P(w,0),5,5);at(P(w,1),7,5);at(P(w,2),books[3][0],books[3][1]);
  w.t=C.ROUND.suddenAtMs-DT;const ev=run(w,1500);
  assert.ok(ev.filter(e=>e.type==='book').length>=4);assert.equal(w.cells[idx(...books[0])],CELL.book);
  assert.equal(P(w,2).alive,false,'knocked out by the 4th book');
  w.t=C.ROUND.suddenAtMs;w.bookNext=0;for(const [x,y] of books)w.cells[idx(x,y)]=CELL.floor;
  run(w,30000-DT);assert.equal(w.bookNext,books.length,'all books fall by the end of the round');
});

test('the last side standing wins the round; simultaneous knock-out or time-up is a draw',()=>{
  let w=world({slots:[0,1]});P(w,1).alive=false;run(w,DT);assert.deepEqual(w.result,{winner:'s0',why:'last_side'});
  w=world({slots:[0,1]});at(P(w,0),5,1);at(P(w,1),6,1);Sim.trap(w,P(w,0),0);Sim.trap(w,P(w,1),0);run(w,4100);assert.deepEqual(w.result,{winner:null,why:'all_out'});
  w=world({slots:[0,1],t:C.ROUND.playMs-50});at(P(w,0),5,5);at(P(w,1),9,9);run(w,100);assert.deepEqual(w.result,{winner:null,why:'time'});
  w=world({mode:'team',slots:[0,1,2,3]});P(w,1).alive=false;P(w,2).alive=false;run(w,DT);assert.equal(w.result.winner,'t0');
});

test('first to 2 round wins takes the match; too many draws end in a draw',()=>{
  let m=Match.create({rounds:3});assert.equal(Match.record(m,{winner:'s0'}),null);assert.equal(Match.record(m,{winner:'s1'}),null);
  assert.deepEqual(Match.record(m,{winner:'s0'}),{winner:'s0'});
  m=Match.create({rounds:3});for(let i=0;i<4;i++)assert.equal(Match.record(m,{winner:null}),null);assert.deepEqual(Match.record(m,{winner:null}),{winner:null});
  m=Match.create({rounds:5});for(const s of ['t0','t1','t0','t1'])Match.record(m,{winner:s});assert.deepEqual(Match.record(m,{winner:'t1'}),{winner:'t1'});
});

test('team mode puts left corners in orange and right corners in blue',()=>{
  const w=world({mode:'team',slots:[0,1,2,3]});assert.deepEqual(w.players.map(p=>[p.slot,p.team]),[[0,0],[1,1],[2,1],[3,0]]);
});

test('a guest world applying the host\'s events ends with the host\'s grid',()=>{
  const host=world({slots:[0,1],open:false,seed:11}),guest=Sim.createWorld({seed:11,roster:[{slot:0},{slot:1}],authority:false});
  guest.t=host.t=0;const log=[];
  const p=P(host,0);at(p,1,1);p.fire=3;
  for(let k=0;k<600;k++){const input=k%90===0?{0:{dx:0,dy:0,place:true}}:{0:{dx:k%180<90?1:0,dy:k%180<90?0:1}};log.push(...Sim.step(host,DT,input));Sim.step(guest,DT,{});}
  for(const e of log)Sim.apply(guest,e);
  assert.ok(log.some(e=>e.type==='burst'&&e.crates.length),'crates were broken');
  assert.equal(Grid.hash(guest.cells,guest.lying),Grid.hash(host.cells,host.lying));
});

const AI=require('../game/ai.cjs');
test('a computer player steps out of a blast it can see coming',()=>{
  for(const level of [0,1,2]){
    const w=world({slots:[0,2]});const bot=P(w,0),q=P(w,2);at(bot,3,1);at(q,5,1);q.fire=3;Sim.place(w,q);at(q,11,9);
    w.balloons[0].explodeAt=w.t+1200;const brain=AI.create(level,7);
    run(w,1800,()=>({0:AI.input(w,bot,brain)}));
    assert.ok(bot.alive&&!bot.trapped,'level '+level+' escaped (at '+bot.x.toFixed(2)+','+bot.y.toFixed(2)+')');
  }
});

test('a 4-computer free-for-all plays out: most rounds end before time and nobody stays stuck',()=>{
  let decided=0;const runs=[[3,1],[8,2],[21,1],[34,0],[5,2],[13,0]];
  for(const [seed,level] of runs){
    const w=Sim.createWorld({seed,mode:'ffa',roster:[0,1,2,3].map(slot=>({slot,kind:'bot'}))});w.t=0;
    const brains=Object.fromEntries(w.players.map(p=>[p.slot,AI.create(level,seed*10+p.slot)]));
    const lastMove=Object.fromEntries(w.players.map(p=>[p.slot,{t:0,x:p.x,y:p.y}]));let longest=0;
    while(!w.result){
      const inputs={};for(const p of w.players)if(p.alive)inputs[p.slot]=AI.input(w,p,brains[p.slot]);
      Sim.step(w,DT,inputs);
      for(const p of w.players){const m=lastMove[p.slot];if(!p.alive||p.trapped||Math.hypot(p.x-m.x,p.y-m.y)>0.5){lastMove[p.slot]={t:w.t,x:p.x,y:p.y};}else longest=Math.max(longest,w.t-m.t);}
    }
    if(w.result.why!=='time')decided++;
    assert.ok(longest<15000,'seed '+seed+': someone stood still for '+Math.round(longest)+' ms');
  }
  assert.ok(decided>=runs.length-2,decided+' of '+runs.length+' rounds were decided before time');
});
