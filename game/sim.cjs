'use strict';
// One round of play (SPEC §2–§7): movement, balloons, splashes, bubbles, items, kicking, books.
//
// The simulation is authoritative on the room host (and in solo play). On a guest it runs with
// `authority:false`: it moves the local player, slides balloons and draws predicted splashes,
// but crates, items, bubbles and knock-outs change only through events from the host
// (`apply`). Every change an authoritative world makes is also pushed to `world.out` as an
// event, so the host can broadcast exactly what happened.
//
// Coordinates: cells; the centre of cell (i, j) is (i, j). A player is a 0.98-wide box.
const {W,H,CELL,ITEMS,PLAYER,BALLOON,TRAP,ROUND,SPAWNS}=require('./config.cjs');
const Grid=require('./grid.cjs');
const HALF=0.49,EPS=1e-6,DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const {idx}=Grid;

function createWorld({seed=1,items='advanced',mode='ffa',roster=[],authority=true,playMs=ROUND.playMs,suddenAtMs=ROUND.suddenAtMs}={}){
  const {cells,hidden}=Grid.build(seed,{items});
  const w={seed,items,mode,authority,playMs,suddenAtMs,t:-ROUND.countdownMs,cells,hidden,lying:new Int8Array(W*H).fill(-1),
    balloons:[],nextId:1,splashes:[],players:[],books:Grid.bookOrder(),bookNext:0,out:[],requests:[],result:null,
    // host: latest own-timeline reports of remote players, for fair bubble judging (§11)
    posOf:null};
  for(const r of roster)w.players.push(createPlayer(r));
  return w;
}
function createPlayer({slot,team=null,kind='human',owner='local',name=''}){
  const [x,y]=SPAWNS[slot];if(team===null)team=x<W/2?0:1; // left corners orange, right corners blue
  return {slot,team,kind,owner,name,x,y,face:[0,1],moving:false,alive:true,trapped:null,invulnUntil:0,
    bombs:PLAYER.bombs,fire:PLAYER.fire,shoes:0,kick:false,needles:0,
    stats:{traps:0,rescues:0,crates:0,pops:0},reports:[],checked:0};
}
const player=(w,slot)=>w.players.find(p=>p.slot===slot);
const speedOf=p=>p.trapped?PLAYER.bubbleSpeed:Math.min(PLAYER.maxSpeed,PLAYER.speed+PLAYER.shoe*p.shoes);
const cellOf=p=>[Math.round(p.x),Math.round(p.y)];
const balloonAt=(w,x,y)=>w.balloons.find(b=>b.x===x&&b.y===y);
const sideOf=(w,p)=>w.mode==='team'?'t'+p.team:'s'+p.slot;
const emit=(w,e)=>{if(w.authority)w.out.push({...e,t:Math.round(w.t)});};

// ---------------- movement (§2) ----------------
function solidFor(w,p,x,y){
  if(!Grid.inside(x,y))return true;
  if(w.cells[idx(x,y)]!==CELL.floor)return true;
  const b=balloonAt(w,x,y);return !!b&&!b.pass.includes(p.slot);
}
function overlaps(px,py,x,y){return Math.abs(px-x)<0.5+HALF-EPS&&Math.abs(py-y)<0.5+HALF-EPS;}
function blockedAt(w,p,px,py){
  for(let y=Math.round(py)-1;y<=Math.round(py)+1;y++)for(let x=Math.round(px)-1;x<=Math.round(px)+1;x++)
    if(overlaps(px,py,x,y)&&solidFor(w,p,x,y))return true;
  return false;
}
// Moves along one axis; a blocked move next to a lane slides into the lane (corner assist).
function moveAxis(w,p,ax,sgn,dist){
  const perp=ax==='x'?'y':'x',vec=m=>ax==='x'?[m*sgn,0]:[0,m*sgn];
  const can=(dx,dy)=>!blockedAt(w,p,p.x+dx,p.y+dy),go=(dx,dy)=>{p.x+=dx;p.y+=dy;};
  let left=dist;
  while(left>EPS){
    const d=Math.min(left,0.2);
    if(can(...vec(d))){go(...vec(d));left-=d;continue;}
    // The largest part of the step that fits (so players end exactly against walls).
    let lo=0,hi=d;for(let k=0;k<14;k++){const m=(lo+hi)/2;if(can(...vec(m)))lo=m;else hi=m;}
    if(lo>1e-4){go(...vec(lo));left-=lo;continue;}
    const lane=Math.round(p[perp]),off=p[perp]-lane;
    const ax2=ax==='x'?Math.round(p.x)+sgn:lane,ay2=ax==='y'?Math.round(p.y)+sgn:lane;
    if(Math.abs(off)>EPS&&Math.abs(off)<=PLAYER.assist&&!solidFor(w,p,ax2,ay2)){
      const m=Math.min(Math.abs(off),left)*-Math.sign(off),v=perp==='x'?[m,0]:[0,m];
      if(can(...v)){go(...v);left-=Math.abs(m);continue;}
    }
    // A kick (§6): blocked by a balloon right ahead in our lane.
    if(p.kick&&Math.abs(off)<0.05){const b=balloonAt(w,ax2,ay2);if(b&&!b.slide&&!b.pass.includes(p.slot)){const kx=ax==='x'?sgn:0,ky=ax==='y'?sgn:0;
      // A guest slides it at once (prediction) and asks the host, which answers with 'kick'.
      if(w.authority)kick(w,b,kx,ky,p);else if(b.id>0){b.slide={dx:kx,dy:ky};b.off=0;w.requests.push({type:'req-kick',id:b.id,dx:kx,dy:ky});}}}
    break;
  }
}
function movePlayer(w,p,input,dt){
  const dx=input.dx|0,dy=input.dy|0;p.moving=!!(dx||dy);
  if(!p.moving||!p.alive)return;
  p.face=[dx,dy];
  const dist=speedOf(p)*dt/1000;
  if(dx)moveAxis(w,p,'x',Math.sign(dx),dist);else moveAxis(w,p,'y',Math.sign(dy),dist);
}

// ---------------- balloons (§3, §6) ----------------
function place(w,p,{t=w.t,id=null,x=null,y=null,explodeAt=null,range=null}={}){
  if(!p.alive||p.trapped)return null;
  const [cx,cy]=x===null?cellOf(p):[x,y];
  if(w.cells[idx(cx,cy)]!==CELL.floor||balloonAt(w,cx,cy))return null;
  if(w.balloons.filter(b=>b.owner===p.slot).length>=p.bombs)return null;
  const b={id:id??(w.nextId++),x:cx,y:cy,owner:p.slot,placedAt:Math.round(t),explodeAt:explodeAt??Math.round(t+BALLOON.fuseMs),range:range??p.fire,
    pass:w.players.filter(q=>q.alive&&overlaps(q.x,q.y,cx,cy)).map(q=>q.slot),slide:null,off:0};
  if(id!==null&&id>=w.nextId)w.nextId=id+1;
  w.balloons.push(b);emit(w,{type:'place',id:b.id,x:cx,y:cy,owner:p.slot,explodeAt:b.explodeAt,range:b.range});return b;
}
function kick(w,b,dx,dy,by){b.slide={dx,dy};b.off=0;emit(w,{type:'kick',id:b.id,x:b.x,y:b.y,dx,dy,by:by?by.slot:null});}
function balloonBlocked(w,b,x,y){
  if(!Grid.inside(x,y)||w.cells[idx(x,y)]!==CELL.floor)return true;
  if(w.balloons.some(o=>o!==b&&o.x===x&&o.y===y))return true;
  return w.players.some(p=>p.alive&&overlaps(p.x,p.y,x,y));
}
function slideBalloons(w,dt){
  for(const b of w.balloons){
    if(!b.slide)continue;
    const nx=b.x+b.slide.dx,ny=b.y+b.slide.dy;
    if(balloonBlocked(w,b,nx,ny)){b.slide=null;b.off=0;emit(w,{type:'stop',id:b.id,x:b.x,y:b.y});continue;}
    b.off+=BALLOON.kickSpeed*dt/1000;
    while(b.off>=1&&b.slide){b.x+=b.slide.dx;b.y+=b.slide.dy;b.off-=1;b.pass=[];
      if(balloonBlocked(w,b,b.x+b.slide.dx,b.y+b.slide.dy)){b.slide=null;b.off=0;emit(w,{type:'stop',id:b.id,x:b.x,y:b.y});}}
  }
}
// Cells a balloon would splash right now (pure; guests use it to predict).
function blastCells(w,b,cellsNow=w.cells,balloonsNow=w.balloons){
  const out=[{i:idx(b.x,b.y),stop:null}];
  for(const [dx,dy] of DIRS)for(let k=1;k<=b.range;k++){
    const x=b.x+dx*k,y=b.y+dy*k;if(!Grid.inside(x,y))break;
    const c=cellsNow[idx(x,y)];
    if(c===CELL.wall||c===CELL.furniture||c===CELL.book)break;
    if(c===CELL.crate){out.push({i:idx(x,y),stop:'crate'});break;}
    const o=balloonsNow.find(q=>q!==b&&q.x===x&&q.y===y);
    if(o){out.push({i:idx(x,y),stop:'balloon',id:o.id});break;}
    out.push({i:idx(x,y),stop:null});
  }
  return out;
}
// Authoritative burst of one balloon plus its chain, all at time t.
function burst(w,first,t){
  const queue=[first],done=new Set(),cells=new Set(),crates=[],washed=[],revealed=[],chain=[],credit={};
  const freshItems=new Set();
  while(queue.length){
    const b=queue.shift();if(done.has(b.id))continue;done.add(b.id);chain.push(b.id);
    w.balloons=w.balloons.filter(o=>o!==b);
    for(const c of blastCells(w,b)){
      cells.add(c.i);
      if(c.stop==='crate'){w.cells[c.i]=CELL.floor;crates.push(c.i);const owner=player(w,b.owner);if(owner){owner.stats.crates++;credit[b.owner]=(credit[b.owner]||0)+1;}
        if(w.hidden[c.i]>=0){w.lying[c.i]=w.hidden[c.i];w.hidden[c.i]=-1;freshItems.add(c.i);revealed.push([c.i,w.lying[c.i]]);}}
      else if(c.stop==='balloon'){const o=w.balloons.find(q=>q.id===c.id);if(o)queue.push(o);}
      else if(w.lying[c.i]>=0&&!freshItems.has(c.i)){w.lying[c.i]=-1;washed.push(c.i);}
    }
  }
  const splash={cells:[...cells],t0:Math.round(t),until:Math.round(t+BALLOON.splashMs),owner:first.owner};
  w.splashes.push(splash);
  emit(w,{type:'burst',ids:chain,cells:splash.cells,crates,washed,revealed,owner:first.owner,credit});
  return splash;
}

// ---------------- bubbles, touches, items (§4, §5) ----------------
function trap(w,p,by){
  if(!p.alive||p.trapped||w.t<p.invulnUntil)return;
  p.trapped={until:Math.round(w.t+TRAP.ms),by};
  const o=player(w,by);if(o&&o!==p&&(w.mode!=='team'||o.team!==p.team))o.stats.traps++;
  emit(w,{type:'trap',slot:p.slot,by,until:p.trapped.until});
}
function knockOut(w,p,why,by=null){if(!p.alive)return;p.alive=false;p.trapped=null;emit(w,{type:'out',slot:p.slot,why,by});}
function free(w,p,by){p.trapped=null;p.invulnUntil=Math.round(w.t+TRAP.freeInvulnMs);emit(w,{type:'free',slot:p.slot,by});}
function useNeedle(w,p){if(!p.alive||!p.trapped||p.needles<1)return false;p.needles--;free(w,p,'needle');return true;}
function inSplash(s,x,y){return s.cells.includes(idx(Math.round(x),Math.round(y)));}
function judgeSplashes(w){
  for(const p of w.players){
    if(!p.alive||p.trapped)continue;
    if(p.owner==='remote'&&w.posOf){
      // Judge by the player's own reported positions (their timeline, §11).
      for(const r of w.posOf(p.slot,p.checked)){p.checked=r.t;
        const s=w.splashes.find(s=>r.t>=s.t0&&r.t<=s.until&&inSplash(s,r.x,r.y));if(s){trap(w,p,s.owner);break;}}
      continue;
    }
    const s=w.splashes.find(s=>w.t>=s.t0&&w.t<=s.until&&inSplash(s,p.x,p.y));if(s)trap(w,p,s.owner);
  }
}
function touches(w){
  for(const p of w.players){
    if(!p.alive||!p.trapped)continue;
    if(w.t>=p.trapped.until){knockOut(w,p,'timer');continue;}
    for(const q of w.players){
      if(q===p||!q.alive||q.trapped)continue;
      if(Math.hypot(q.x-p.x,q.y-p.y)>=PLAYER.touch)continue;
      if(w.mode==='team'&&q.team===p.team){q.stats.rescues++;free(w,p,q.slot);}
      else{q.stats.pops++;knockOut(w,p,'pop',q.slot);}
      break;
    }
  }
}
function pickItems(w){
  for(const p of w.players){
    if(!p.alive||p.trapped)continue;const [x,y]=cellOf(p);if(!Grid.inside(x,y))continue;const i=idx(x,y),item=w.lying[i];if(!(item>=0))continue;
    const name=ITEMS[item];
    if(name==='needle'&&p.needles>=PLAYER.maxNeedles)continue;
    w.lying[i]=-1;applyItem(p,name);emit(w,{type:'pick',slot:p.slot,i,item:name});
  }
}
function applyItem(p,name){
  if(name==='bomb')p.bombs=Math.min(PLAYER.maxBombs,p.bombs+1);
  else if(name==='fire')p.fire=Math.min(PLAYER.maxFire,p.fire+1);
  else if(name==='shoe')p.shoes=Math.min(Math.round((PLAYER.maxSpeed-PLAYER.speed)/PLAYER.shoe),p.shoes+1);
  else if(name==='kick')p.kick=true;
  else if(name==='needle')p.needles=Math.min(PLAYER.maxNeedles,p.needles+1);
}

// ---------------- sudden death (§7) ----------------
function dropBooks(w){
  const every=(w.playMs-w.suddenAtMs)/w.books.length;
  while(w.bookNext<w.books.length&&w.t>=w.suddenAtMs+w.bookNext*every){
    const [x,y]=w.books[w.bookNext++],i=idx(x,y);
    w.cells[i]=CELL.book;w.lying[i]=-1;w.hidden[i]=-1;emit(w,{type:'book',x,y});
    const b=balloonAt(w,x,y);if(b)burst(w,b,w.t);
    for(const p of w.players)if(p.alive&&overlaps(p.x,p.y,x,y)&&Math.round(p.x)===x&&Math.round(p.y)===y)knockOut(w,p,'book');
  }
}

// ---------------- round end (§7) ----------------
function aliveSides(w){return new Set(w.players.filter(p=>p.alive).map(p=>sideOf(w,p)));}
function checkEnd(w){
  if(w.result)return;
  const sides=aliveSides(w);
  if(sides.size<=1||w.t>=w.playMs){
    const winner=sides.size===1?[...sides][0]:null;
    w.result={winner,why:sides.size===0?'all_out':sides.size===1?'last_side':'time'};
    emit(w,{type:'end',winner,why:w.result.why});
  }
}

// ---------------- the step ----------------
// inputs: slot → {dx, dy, place (edge), needle (edge)} for players this machine drives.
function step(w,dt,inputs={}){
  w.out.length=0;
  w.t+=dt;
  if(w.t<0||w.result)return w.out;
  for(const p of w.players){const i=inputs[p.slot];if(!i||p.owner==='remote')continue;
    movePlayer(w,p,i,dt);
    if(w.authority){if(i.place)place(w,p);if(i.needle)useNeedle(w,p);}}
  // Balloons you stand on stay passable until you step off them.
  for(const b of w.balloons)b.pass=b.pass.filter(s=>{const p=player(w,s);return p&&overlaps(p.x,p.y,b.x,b.y);});
  slideBalloons(w,dt);
  if(!w.authority){w.splashes=w.splashes.filter(s=>w.t<=s.until+400);return w.out;}
  for(const b of w.balloons.slice())if(w.t>=b.explodeAt&&w.balloons.includes(b))burst(w,b,b.explodeAt);
  // A balloon that slides into a live splash bursts at once (§6).
  for(const b of w.balloons.slice())if(w.balloons.includes(b)&&w.splashes.some(s=>w.t>=s.t0&&w.t<=s.until&&s.cells.includes(idx(b.x,b.y))))burst(w,b,w.t);
  if(w.t>=w.suddenAtMs)dropBooks(w);
  judgeSplashes(w);touches(w);pickItems(w);
  w.splashes=w.splashes.filter(s=>w.t<=s.until+400);
  checkEnd(w);
  return w.out;
}

// ---------------- guests: apply the host's events ----------------
function apply(w,e){
  const p=e.slot!==undefined?player(w,e.slot):null;
  switch(e.type){
    case 'place':{if(w.balloons.some(b=>b.id===e.id))break;
      const mine=w.balloons.find(b=>b.id<0&&b.x===e.x&&b.y===e.y&&b.owner===e.owner);if(mine){mine.id=e.id;mine.explodeAt=e.explodeAt;mine.range=e.range;break;}
      w.balloons=w.balloons.filter(b=>!(b.x===e.x&&b.y===e.y));
      w.balloons.push({id:e.id,x:e.x,y:e.y,owner:e.owner,placedAt:e.t,explodeAt:e.explodeAt,range:e.range,pass:w.players.filter(q=>overlaps(q.x,q.y,e.x,e.y)).map(q=>q.slot),slide:null,off:0});break;}
    case 'reject':{w.balloons=w.balloons.filter(b=>b.id!==e.localId);break;}
    case 'kick':{const b=w.balloons.find(b=>b.id===e.id);if(b){b.x=e.x;b.y=e.y;b.off=0;b.slide={dx:e.dx,dy:e.dy};}break;}
    case 'stop':{const b=w.balloons.find(b=>b.id===e.id);if(b){b.x=e.x;b.y=e.y;b.off=0;b.slide=null;}break;}
    case 'burst':{
      w.balloons=w.balloons.filter(b=>!e.ids.includes(b.id));
      for(const i of e.crates)w.cells[i]=CELL.floor;for(const i of e.washed)w.lying[i]=-1;
      for(const [i,item] of e.revealed){w.lying[i]=item;w.hidden[i]=-1;}
      for(const [slot,n] of Object.entries(e.credit||{})){const o=player(w,+slot);if(o)o.stats.crates+=n;}
      w.splashes=w.splashes.filter(s=>!s.predicted||!s.ids.some(id=>e.ids.includes(id)));
      w.splashes.push({cells:e.cells,t0:e.t,until:e.t+BALLOON.splashMs,owner:e.owner});break;}
    case 'trap':{if(p){p.trapped={until:e.until,by:e.by};const o=player(w,e.by);if(o&&o!==p&&(w.mode!=='team'||o.team!==p.team))o.stats.traps++;}break;}
    case 'free':{if(p){p.trapped=null;p.invulnUntil=e.t+TRAP.freeInvulnMs;if(e.by==='needle')p.needles=Math.max(0,p.needles-1);else{const q=player(w,e.by);if(q)q.stats.rescues++;}}break;}
    case 'out':{if(p){p.alive=false;p.trapped=null;if(e.why==='pop'){const q=player(w,e.by);if(q)q.stats.pops++;}}break;}
    case 'pick':{w.lying[e.i]=-1;if(p)applyItem(p,e.item);break;}
    case 'book':{const i=idx(e.x,e.y);w.cells[i]=CELL.book;w.lying[i]=-1;w.hidden[i]=-1;w.bookNext++;break;}
    case 'end':{w.result={winner:e.winner,why:e.why};break;}
  }
}
// Guests: at a balloon's fuse time, show the splash we expect until the host's burst arrives.
function predictBursts(w){
  const shown=new Set(w.splashes.filter(s=>s.predicted).flatMap(s=>s.ids));
  for(const b of w.balloons)if(w.t>=b.explodeAt&&!shown.has(b.id)&&b.id>0){
    w.splashes.push({cells:blastCells(w,b).map(c=>c.i),t0:b.explodeAt,until:b.explodeAt+BALLOON.splashMs,owner:b.owner,predicted:true,ids:[b.id]});
  }
}

module.exports={createWorld,createPlayer,player,step,apply,place,kick,burst,blastCells,predictBursts,useNeedle,trap,movePlayer,speedOf,cellOf,balloonAt,aliveSides,sideOf,overlaps,HALF};
