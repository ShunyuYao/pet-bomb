'use strict';
// Computer players (SPEC §9). They read the same world a human sees: every balloon's fuse and
// cross, splashes, crates, items and players. Plan on the grid (BFS), then walk cell centre to
// cell centre with the same inputs a keyboard gives.
//   easy   — slow to react, rarely attacks
//   normal — dodges well, breaks crates, attacks when it has an escape
//   hard   — quick, also pops trapped opponents, frees trapped teammates, kicks balloons at people
const {W,H,CELL,BALLOON,ITEMS,ROUND}=require('./config.cjs');
const Grid=require('./grid.cjs'),Sim=require('./sim.cjs');
const {idx}=Grid;
const LEVELS=[
  {name:'简单',thinkMs:420,attack:0.25,crate:0.6,pop:false,kick:false,needle:false},
  {name:'普通',thinkMs:220,attack:0.6,crate:0.9,pop:false,kick:false,needle:true},
  {name:'困难',thinkMs:110,attack:0.9,crate:1,pop:true,kick:true,needle:true},
];
const N4=[[1,0],[-1,0],[0,1],[0,-1]];

// Earliest time each cell gets splashed (chains included); Infinity = safe.
function dangerMap(w,extra=null){
  const d=new Float64Array(W*H).fill(Infinity);
  const balloons=w.balloons.map(b=>({...b,at:b.explodeAt}));if(extra)balloons.push({...extra,at:extra.explodeAt});
  for(let pass=0;pass<4;pass++){
    let changed=false;
    for(const b of balloons)for(const c of Sim.blastCells(w,b,w.cells,balloons)){
      if(b.at<d[c.i])d[c.i]=b.at;
      if(c.stop==='balloon'){const o=balloons.find(q=>q.id===c.id);if(o&&o.at>b.at){o.at=b.at;changed=true;}}
    }
    if(!changed)break;
  }
  for(const s of w.splashes)if(w.t<=s.until)for(const i of s.cells)d[i]=Math.min(d[i],s.t0);
  // Books about to fall in the last 30 s (§7) are deadly too.
  const every=(w.playMs-w.suddenAtMs)/w.books.length;
  for(let k=w.bookNext;k<w.books.length;k++){const at=w.suddenAtMs+k*every;if(at>w.t+6000)break;const i=idx(...w.books[k]);d[i]=Math.min(d[i],at);}
  return d;
}
const unsafeAt=(d,i,t)=>t>=d[i]-200&&t<=d[i]+BALLOON.splashMs+150;
// (a book cell stays deadly: it becomes a wall, and BFS will not enter walls)
function passable(w,p,x,y,start){
  if(!Grid.inside(x,y)||w.cells[idx(x,y)]!==CELL.floor)return false;
  const b=Sim.balloonAt(w,x,y);return !b||(start&&b.pass.includes(p.slot));
}
// BFS from the bot's cell; returns {dist, prev, arrive} arrays. Paths avoid cells that are
// splashed when the bot would be there.
function reach(w,p,d,maxSteps=40){
  const [sx,sy]=Sim.cellOf(p),speed=Sim.speedOf(p),n=W*H;
  const dist=new Int16Array(n).fill(-1),prev=new Int16Array(n).fill(-1);const q=[idx(sx,sy)];dist[q[0]]=0;
  while(q.length){
    const i=q.shift(),x=i%W,y=(i-x)/W;if(dist[i]>=maxSteps)continue;
    for(const [dx,dy] of N4){
      const nx=x+dx,ny=y+dy,j=idx(nx,ny);if(dist[j]>=0||!passable(w,p,nx,ny,false))continue;
      const t=w.t+(dist[i]+1)/speed*1000;if(unsafeAt(d,j,t)||unsafeAt(d,j,t-120))continue;
      dist[j]=dist[i]+1;prev[j]=i;q.push(j);
    }
  }
  return {dist,prev,start:idx(sx,sy)};
}
function pathTo(r,goal){const out=[];let i=goal;while(i!==r.start&&i>=0){out.unshift(i);i=r.prev[i];}return i===r.start?out:null;}
function nearest(r,test){let best=-1;for(let i=0;i<r.dist.length;i++)if(r.dist[i]>=0&&test(i)&&(best<0||r.dist[i]<r.dist[best]))best=i;return best;}
function lineClear(w,x0,y0,x1,y1,range){
  if(x0!==x1&&y0!==y1)return false;const n=Math.abs(x1-x0)+Math.abs(y1-y0);if(n>range)return false;if(n===0)return true;
  const sx=Math.sign(x1-x0),sy=Math.sign(y1-y0);for(let k=1;k<n;k++){const c=w.cells[idx(x0+sx*k,y0+sy*k)];if(c!==CELL.floor||Sim.balloonAt(w,x0+sx*k,y0+sy*k))return false;}return true;
}
const foes=(w,p)=>w.players.filter(q=>q!==p&&q.alive&&(w.mode!=='team'||q.team!==p.team));
const mates=(w,p)=>w.players.filter(q=>q!==p&&q.alive&&w.mode==='team'&&q.team===p.team);

function create(level=1,seed=1){return {L:LEVELS[Math.max(0,Math.min(2,level))],path:[],next:0,rng:Grid.rng(seed),placed:false,stuckAt:0,last:null};}

function think(w,p,brain){
  const L=brain.L,d=dangerMap(w),[cx,cy]=Sim.cellOf(p),here=idx(cx,cy);
  brain.path=[];brain.wantPlace=false;brain.wantNeedle=false;
  if(p.trapped){brain.why='trapped';
    if(L.needle&&p.needles>0){brain.wantNeedle=true;return;}
    // Drift towards a teammate who can free us.
    const m=mates(w,p)[0];if(m){const r=reach(w,p,new Float64Array(W*H).fill(Infinity),12);const path=pathTo(r,idx(...Sim.cellOf(m)));if(path)brain.path=path;}
    return;
  }
  const r=reach(w,p,d);
  // 1. Get out of any blast that will reach us.
  if(d[here]!==Infinity){brain.why='flee';const safe=nearest(r,i=>d[i]===Infinity);if(safe>=0)brain.path=pathTo(r,safe)||[];return;}
  // 2. Hard: pop a trapped opponent, free a trapped teammate.
  if(L.pop){
    for(const q of w.players){if(q===p||!q.alive||!q.trapped)continue;const g=idx(...Sim.cellOf(q));if(r.dist[g]>=0&&r.dist[g]<=10){brain.why='pop';brain.path=pathTo(r,g)||[];return;}}
  }
  // 3. Attack: a foe in a clear line within range, and we can still escape.
  const canEscape=()=>{const fake={id:-1,x:cx,y:cy,range:p.fire,explodeAt:w.t+BALLOON.fuseMs};const d2=dangerMap(w,fake);
    const r2=reach(w,{...p,x:cx,y:cy},d2);return nearest(r2,i=>d2[i]===Infinity&&i!==here)>=0;};
  const mine=w.balloons.filter(b=>b.owner===p.slot).length;
  if(mine<p.bombs&&!Sim.balloonAt(w,cx,cy)){
    const target=foes(w,p).find(q=>!q.trapped&&lineClear(w,cx,cy,...Sim.cellOf(q),p.fire));
    if(target&&brain.rng()<L.attack&&canEscape()){brain.why='attack';brain.wantPlace=true;return;}
    const nextToCrate=N4.some(([dx,dy])=>w.cells[idx(cx+dx,cy+dy)]===CELL.crate);
    if(nextToCrate&&brain.rng()<L.crate&&canEscape()){brain.why='crate';brain.wantPlace=true;return;}
  }
  // 4. Hard: kick a balloon at a foe standing in its line.
  if(L.kick&&p.kick)for(const [dx,dy] of N4){
    const b=Sim.balloonAt(w,cx+dx,cy+dy);if(!b||b.slide)continue;
    if(foes(w,p).some(q=>{const [qx,qy]=Sim.cellOf(q);return (dx&&qy===cy&&Math.sign(qx-cx)===dx)||(dy&&qx===cx&&Math.sign(qy-cy)===dy);})){brain.why='kick';brain.kickDir=[dx,dy];return;}
  }
  // 5. Items close by.
  const item=nearest(r,i=>w.lying[i]>=0&&!(ITEMS[w.lying[i]]==='needle'&&p.needles>0)&&r.dist[i]<=8);
  if(item>=0){brain.why='item';brain.path=pathTo(r,item)||[];return;}
  // 6. A cell next to a crate, else towards the nearest foe.
  const crateSpot=nearest(r,i=>{const x=i%W,y=(i-x)/W;return i!==here&&d[i]===Infinity&&N4.some(([dx,dy])=>Grid.inside(x+dx,y+dy)&&w.cells[idx(x+dx,y+dy)]===CELL.crate);});
  if(crateSpot>=0){brain.why='to-crate';brain.path=pathTo(r,crateSpot)||[];return;}
  const f=foes(w,p).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  if(f){const [fx,fy]=Sim.cellOf(f);const near=nearest(r,i=>{const x=i%W,y=(i-x)/W;return i!==here&&d[i]===Infinity&&lineClear(w,x,y,fx,fy,Math.max(1,p.fire-1));});if(near>=0){brain.why='to-foe';brain.path=pathTo(r,near)||[];return;}}
  // 7. Otherwise wander a little.
  brain.why='wander';const opts=N4.filter(([dx,dy])=>r.dist[idx(cx+dx,cy+dy)]>=0);if(opts.length){const [dx,dy]=opts[Math.floor(brain.rng()*opts.length)];brain.path=[idx(cx+dx,cy+dy)];}
}

// → keyboard-like input for this frame.
function input(w,p,brain){
  if(!p.alive)return {dx:0,dy:0};
  if(w.t>=brain.next){brain.next=w.t+brain.L.thinkMs;brain.kickDir=null;think(w,p,brain);}
  if(brain.wantNeedle){brain.wantNeedle=false;return {dx:0,dy:0,needle:true};}
  if(brain.wantPlace){brain.wantPlace=false;brain.next=w.t;return {dx:0,dy:0,place:true};}
  if(brain.kickDir)return {dx:brain.kickDir[0],dy:brain.kickDir[1]};
  const thr=Math.max(0.05,Sim.speedOf(p)/60*0.6);
  while(brain.path.length){
    const i=brain.path[0],tx=i%W,ty=(i-tx)/W,[cx,cy]=Sim.cellOf(p);
    if(Math.abs(p.x-tx)<thr&&Math.abs(p.y-ty)<thr){brain.path.shift();continue;}
    // Line up on the lane first, then walk along it.
    if(tx!==cx)return Math.abs(p.y-ty)>thr?{dx:0,dy:Math.sign(ty-p.y)}:{dx:Math.sign(tx-p.x),dy:0};
    if(ty!==cy)return Math.abs(p.x-tx)>thr?{dx:Math.sign(tx-p.x),dy:0}:{dx:0,dy:Math.sign(ty-p.y)};
    return Math.abs(p.x-tx)>=thr?{dx:Math.sign(tx-p.x),dy:0}:{dx:0,dy:Math.sign(ty-p.y)};
  }
  // No path: settle on the cell centre (so the next plan starts aligned).
  const [cx,cy]=Sim.cellOf(p);
  if(Math.abs(p.x-cx)>thr)return {dx:Math.sign(cx-p.x),dy:0};
  if(Math.abs(p.y-cy)>thr)return {dx:0,dy:Math.sign(cy-p.y)};
  return {dx:0,dy:0};
}
module.exports={LEVELS,create,input,dangerMap};
