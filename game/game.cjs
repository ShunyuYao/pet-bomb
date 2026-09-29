'use strict';
// A match as the screen sees it (SPEC §7, §8): lobby → rounds (countdown, play, round result)
// → match result. Used directly for solo play and by the room host; a guest runs a mirror
// (role 'guest') that follows the host's events.
//
//   phase: 'lobby' | 'count' | 'play' | 'round' (round result on screen) | 'results'
const C=require('./config.cjs'),Sim=require('./sim.cjs'),Match=require('./match.cjs'),AI=require('./ai.cjs'),Grid=require('./grid.cjs');
const BETWEEN_MS=3000;

function create({role='solo',mySlot=0,mode='ffa',rounds=3,items='advanced',cpuLevel=1,seed=(Math.random()*1e9)>>>0,timing=null}={}){
  return {role,mySlot,mode,rounds,items,cpuLevel,seed,timing:timing||{playMs:C.ROUND.playMs,suddenAtMs:C.ROUND.suddenAtMs},rng:Grid.rng(seed),roster:[],match:Match.create({mode,rounds}),
    world:null,round:0,phase:'lobby',between:0,brains:{},out:[],feed:[],matchResult:null,roundResults:[],totals:{}};
}
// Solo sizes: ffa 2–4 players, team always 2v2. LAN rooms are always filled to 4.
function fillBots(humans,{mode='ffa',size=4}={}){
  const list=humans.map(h=>({...h,kind:'human'}));const taken=new Set(list.map(h=>h.slot));
  const total=mode==='team'?4:Math.max(2,Math.min(4,size));
  for(let slot=0;list.length<total&&slot<4;slot++)if(!taken.has(slot))list.push({slot,kind:'bot',owner:'local',name:'电脑'+(slot+1)});
  return list.sort((a,b)=>a.slot-b.slot);
}
function setRoster(g,list){g.roster=list.map(r=>({...r,team:C.SPAWNS[r.slot][0]<C.W/2?0:1}));}
function startMatch(g){g.match=Match.create({mode:g.mode,rounds:g.rounds});g.matchResult=null;g.roundResults=[];g.round=0;g.totals={};startRound(g,(g.rng()*4294967296)>>>0);}
function startRound(g,seed){
  g.round++;g.brains={};
  g.world=Sim.createWorld({seed,items:g.items,mode:g.mode,...g.timing,roster:g.roster.map(r=>({slot:r.slot,team:r.team,kind:r.kind,owner:r.owner||(r.slot===g.mySlot?'local':r.kind==='bot'?'local':'remote'),name:r.name})),authority:g.role!=='guest'});
  for(const r of g.roster)if(r.kind==='bot')g.brains[r.slot]=AI.create(g.cpuLevel,seed+r.slot);
  g.phase='count';g.between=0;
  if(g.role!=='guest')g.out.push({type:'round',no:g.round,seed,mode:g.mode,items:g.items,timing:g.timing,roster:g.roster.map(r=>({slot:r.slot,kind:r.kind,name:r.name,signature:r.signature||''}))});
}
// A seat whose player left becomes a computer player (host / solo).
function takeOver(g,slot){
  const r=g.roster.find(x=>x.slot===slot);if(!r)return;r.kind='bot';r.owner='local';r.name=(r.name||'玩家')+'（电脑接管）';
  const p=g.world&&Sim.player(g.world,slot);if(p){p.kind='bot';p.owner='local';g.brains[slot]=AI.create(g.cpuLevel,g.world.seed+slot);}
  g.out.push({type:'takeover',slot,name:r.name});
}
// input: {dx, dy, place, needle} for this machine's own player. Everything that happened is
// appended to g.out (the caller drains it: the host broadcasts it, solo play shows it) and the
// events of this step are returned.
function step(g,dt,input={dx:0,dy:0}){
  const from=g.out.length,w=g.world,mine=()=>g.out.slice(from);
  if(!w||g.phase==='lobby'||g.phase==='results')return mine();
  if(g.phase==='round'){
    if(g.role==='guest')return mine();
    g.between+=dt;if(g.between>=BETWEEN_MS)startRound(g,(g.rng()*4294967296)>>>0);
    return mine();
  }
  const inputs={};
  const me=Sim.player(w,g.mySlot);if(me&&g.phase!=='count')inputs[g.mySlot]=input;
  if(g.role!=='guest'&&g.phase==='play')for(const p of w.players)if(p.kind==='bot'&&p.alive)inputs[p.slot]=AI.input(w,p,g.brains[p.slot]);
  if(g.role==='guest'&&input.place&&me&&g.phase==='play')guestPlace(g,me);
  if(g.role==='guest'&&input.needle&&me&&me.trapped&&me.needles>0)w.requests.push({type:'req-needle'});
  const events=Sim.step(w,dt,inputs);
  if(g.role==='guest')Sim.predictBursts(w);
  for(const e of events)g.out.push(e);
  if(w.t>=0&&g.phase==='count')g.phase='play';
  if(g.role!=='guest'&&w.result&&g.phase==='play')endRound(g,w.result);
  return mine();
}
function endRound(g,result){
  g.phase='round';g.between=0;g.roundResults.push(result.winner);
  for(const p of g.world.players){const t=g.totals[p.slot]||(g.totals[p.slot]={traps:0,rescues:0,crates:0,pops:0});for(const k in t)t[k]+=p.stats[k];}
  const m=Match.record(g.match,result);
  if(m){g.matchResult={winner:m.winner,wins:{...g.match.wins},stats:statsTable(g)};g.phase='results';g.out.push({type:'match',...g.matchResult});}
}
// Guests place at once (prediction, negative id) and ask the host.
let localIds=-1;
function guestPlace(g,me){
  const w=g.world,[x,y]=Sim.cellOf(me);
  const b=Sim.place(w,me,{id:localIds--,x,y});
  if(b)w.requests.push({type:'req-place',x,y,t:Math.round(w.t),localId:b.id});
}
// Host: a guest asked for something.
function request(g,slot,e){
  const w=g.world;if(!w||g.phase!=='play')return;const p=Sim.player(w,slot);if(!p)return;
  if(e.type==='req-place'){
    const t=Math.max(w.t-300,Math.min(w.t,+e.t||w.t));
    const b=Sim.place(w,p,{t,x:e.x|0,y:e.y|0});
    if(!b)g.out.push({type:'reject',owner:slot,localId:e.localId});
    else g.out.push(...w.out.splice(0));
  }else if(e.type==='req-needle'){if(Sim.useNeedle(w,p))g.out.push(...w.out.splice(0));}
  else if(e.type==='req-kick'){
    const b=w.balloons.find(b=>b.id===e.id);if(!b||b.slide||!p.kick)return;
    const [cx,cy]=Sim.cellOf(p);if(Math.abs(b.x-cx)+Math.abs(b.y-cy)!==1||b.x-cx!==(e.dx|0)||b.y-cy!==(e.dy|0))return;
    Sim.kick(w,b,e.dx|0,e.dy|0,p);g.out.push(...w.out.splice(0));
  }
}
// Guest: the host's events.
function receive(g,e){
  if(e.type==='round'){
    if(e.no===1){g.roundResults=[];g.matchResult=null;}
    g.mode=e.mode||g.mode;g.items=e.items||g.items;if(e.timing)g.timing=e.timing;
    g.roster=e.roster.map(r=>({...r,team:C.SPAWNS[r.slot][0]<C.W/2?0:1,owner:r.slot===g.mySlot?'local':'remote'}));
    g.round=e.no-1;startRound(g,e.seed);return;}
  if(e.type==='match'){g.matchResult={winner:e.winner,wins:e.wins,stats:e.stats};g.phase='results';return;}
  if(e.type==='takeover'){const r=g.roster.find(x=>x.slot===e.slot);if(r){r.kind='bot';r.name=e.name;}return;}
  const w=g.world;if(!w)return;
  if(e.type==='reject'){if(e.owner===g.mySlot)w.balloons=w.balloons.filter(b=>b.id!==e.localId);return;}
  if(e.type==='end'){Sim.apply(w,e);g.phase='round';g.roundResults.push(e.winner);return;}
  Sim.apply(w,e);
}
// Whole-match totals (host); the round-result screen reads the current world's stats.
function statsTable(g){return g.roster.map(r=>({slot:r.slot,name:r.name,team:r.team,...(g.totals[r.slot]||{traps:0,rescues:0,crates:0,pops:0})}));}
module.exports={create,fillBots,setRoster,startMatch,startRound,step,request,receive,takeOver,endRound,statsTable,BETWEEN_MS};
