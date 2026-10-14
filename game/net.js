'use strict';
// Internet / LAN room for the balloon game (SPEC §11) on top of pet-kit: seats, lobby, events, state
// stream, looks and budgets come from the kit; this file only decides what the state carries
// and who is authoritative for what.
//
//   host → guests (state, 20 Hz): phase, round, round clock, every player's position, grid hash
//   guest → host  (state, 20 Hz): its own position on its own round clock (for fair judging)
//   host → guests (events): round, place, kick, stop, burst, trap, free, out, pick, book, end,
//                            match, takeover, reject, grid
//   guest → host  (events): req-place, req-kick, req-needle, req-grid
const {Room}=require('../vendor/pet-kit/index.js');
const Game=require('./game.cjs'),Sim=require('./sim.cjs'),Grid=require('./grid.cjs'),C=require('./config.cjs');

const PROTOCOL={id:'pet-bomb',version:2},PURPOSE='bomb.look.v1';
const INTERP_MS=110,EXTRAP_MS=100,HASH_MS=2000;
const SETTINGS={defaults:{mode:'ffa',rounds:3,items:'advanced',cpu:1},
  validate:v=>({mode:C.MODES.includes(v.mode)?v.mode:'ffa',rounds:C.MATCH.rounds.includes(v.rounds)?v.rounds:3,items:['standard','advanced'].includes(v.items)?v.items:'advanced',cpu:[0,1,2].includes(v.cpu)?v.cpu:1})};
const FACES=[[0,1],[0,-1],[1,0],[-1,0]];
const faceIdx=f=>Math.max(0,FACES.findIndex(([x,y])=>x===f[0]&&y===f[1]));
const packPlayer=p=>[p.slot,Math.round(p.x*100),Math.round(p.y*100),faceIdx(p.face),p.moving?1:0];

function create(sdk,{onLobby=()=>{},onAsset=()=>{},onConnection=()=>{},onClosed=()=>{},onError=()=>{},onFeed=()=>{},now=()=>Date.now(),strict=false,budgetBytes=8*1024,timing=null}={}){
  let game=null,host=false,mySlot=null,lastHash=0,hashMiss=0,remote={ph:'lobby',no:0,wins:{},rr:[]};
  const interp=new Map(),reports=new Map(),budget=[];
  // Remote players are shown INTERP_MS behind, on the round clock the sender stamped (not on
  // arrival time: two samples can arrive in one poll batch, a millisecond apart).
  function pushInterp(slot,s,t){
    if(!Number.isFinite(t))return;const buf=interp.get(slot)||[];const last=buf[buf.length-1];
    if(last&&t<=last.t)return;
    if(last&&Math.hypot(last.s.x-s.x,last.s.y-s.y)>2.5)buf.length=0;
    buf.push({t,s});while(buf.length>16)buf.shift();interp.set(slot,buf);
  }
  function applyInterp(){
    const w=game?.world;if(!w)return;const t=w.t-INTERP_MS;
    for(const p of w.players){
      if(p.owner!=='remote')continue;const buf=interp.get(p.slot);if(!buf?.length)continue;
      let i=buf.length-1;while(i>0&&buf[i-1].t>t)i--;const b=buf[i],a=i>0?buf[i-1]:null;
      let x=b.s.x,y=b.s.y;
      if(a&&a.t<=t&&b.t>=t){const k=(t-a.t)/Math.max(1,b.t-a.t);x=a.s.x+(b.s.x-a.s.x)*k;y=a.s.y+(b.s.y-a.s.y)*k;}
      else if(a&&b.t<t&&b.t-a.t>=20){const k=Math.min(EXTRAP_MS,t-b.t)/(b.t-a.t);x=b.s.x+(b.s.x-a.s.x)*k;y=b.s.y+(b.s.y-a.s.y)*k;}
      p.x=Math.max(1,Math.min(C.W-2,x));p.y=Math.max(1,Math.min(C.H-2,y));p.face=FACES[b.s.f]||p.face;p.moving=!!b.s.m;
    }
  }
  const feed=e=>{try{onFeed(e);}catch(err){onError(err);}};

  const room=Room.create(sdk,{protocol:PROTOCOL,purpose:PURPOSE,maxPlayers:4,now,strict,settings:SETTINGS,
    budget:{guestBytesPerSec:budgetBytes},onBudget:b=>{budget.push(b);if(budget.length>50)budget.shift();},
    hostState(){
      const w=game?.world,s={ph:game?.phase||'lobby',no:game?.round||0,at:Math.round(room.hostNow()),wins:game?.match.wins||{},rr:game?.roundResults||[]};
      if(w){s.t=Math.round(w.t);s.p=w.players.map(packPlayer);if(now()-lastHash>=HASH_MS){lastHash=now();s.h=Grid.hash(w.cells,w.lying);}}
      return s;
    },
    guestState(){
      const w=game?.world,me=w&&Sim.player(w,mySlot);if(!me||game.phase==='lobby')return null;
      return {no:game.round,t:Math.round(w.t),x:Math.round(me.x*100),y:Math.round(me.y*100),f:faceIdx(me.face),m:me.moving?1:0};
    },
    onState(s,slot){
      if(host){
        if(!game?.world||s.no!==game.round)return;
        const r={t:s.t,x:s.x/100,y:s.y/100,f:s.f,m:s.m};pushInterp(slot,r,s.t);
        const list=reports.get(slot)||[];list.push(r);while(list.length>60)list.shift();reports.set(slot,list);
        return;
      }
      remote={ph:s.ph,no:s.no,wins:s.wins||{},rr:s.rr||[]};
      const w=game?.world;if(!w||s.no!==game.round)return;
      if(Number.isFinite(s.t)){const target=s.t+(room.hostNow()-s.at);if(Math.abs(w.t-target)>80)w.t=target;else w.t+=(target-w.t)*0.1;}
      for(const [slot,x,y,f,m] of s.p||[])if(slot!==mySlot)pushInterp(slot,{x:x/100,y:y/100,f,m},s.t);
      if(s.h&&game.phase==='play'){if(s.h!==Grid.hash(w.cells,w.lying)){if(++hashMiss>=2){hashMiss=0;room.emit({type:'req-grid'});}}else hashMiss=0;}
    },
    onEvent(e,from){
      if(host){
        if(e.type==='req-grid'){const w=game?.world;if(w)room.emit({type:'grid',no:game.round,cells:Array.from(w.cells).join(''),lying:Array.from(w.lying,v=>v+1).join('')});return;}
        if(game)Game.request(game,from,e);return;
      }
      if(!game)return;
      if(e.type==='grid'){const w=game.world;if(w&&e.no===game.round){for(let i=0;i<w.cells.length;i++){w.cells[i]=+e.cells[i];w.lying[i]=+e.lying[i]-1;}}return;}
      if(e.type==='round'){interp.clear();}
      Game.receive(game,e);feed(e);
    },
    onLobby:l=>onLobby(l),onAsset,onConnection,onClosed,onError,
    onPeerLeft(slot,{inMatch}){interp.delete(slot);reports.delete(slot);if(host&&game&&inMatch&&game.roster.some(r=>r.slot===slot))Game.takeOver(game,slot);},
  });

  function humans(){return room.lobby().players.filter(p=>!p.waiting&&p.online!==false).map(p=>({slot:p.slot,name:p.name,signature:p.signature,look:p.kind,owner:p.slot===0?'local':'remote'}));}
  function startMatch(){
    const st=room.lobby().settings;
    game=Game.create({role:'host',mySlot:0,mode:st.mode,rounds:st.rounds,items:st.items,cpuLevel:st.cpu,timing});
    Game.setRoster(game,Game.fillBots(humans(),{mode:st.mode,size:4}));
    room.setMatch(true);room.setReady(false);Game.startMatch(game);flush();
  }
  // Every event is sent on its own: one bad event never holds back the ones after it.
  function flush(){
    const list=game.out.splice(0);
    for(const e of list){
      if(e.type==='round'){reports.clear();interp.clear();}
      try{room.emit(e);}catch(err){onError(Error(err.message+' in '+JSON.stringify(e).slice(0,200)));}
      feed(e);
    }
  }
  let autoStartAt=0;
  const api={
    PROTOCOL,room,
    async start(profile,asset){
      const r=await room.start(profile,asset);host=r.role==='host';mySlot=host?0:null;
      if(!host)game=Game.create({role:'guest',mySlot:-1});
      return r;
    },
    get game(){return game;},
    isHost:()=>host,
    mySlot:()=>host?0:room.mySlot(),
    step(dt,input){
      if(!host){const s=room.mySlot();if(s!==null&&s!==mySlot){mySlot=s;if(game)game.mySlot=s;}}
      if(host&&(!game||game.phase==='lobby')){
        const l=room.lobby().players,ready=l.length>=2&&l.every(p=>p.ready||p.waiting);
        if(ready&&!autoStartAt)autoStartAt=now()+600;if(!ready)autoStartAt=0;
        if(autoStartAt&&now()>=autoStartAt){autoStartAt=0;startMatch();}
      }
      if(!game)return [];
      applyInterp();
      if(host&&game.world)game.world.posOf=(slot,since)=>(reports.get(slot)||[]).filter(r=>r.t>since);
      const out=Game.step(game,dt,input);
      if(host)flush();
      else{game.out.length=0;const w=game.world;if(w&&w.requests.length){for(const r of w.requests.splice(0))room.emit(r);}for(const e of out)feed(e);}
      return out;
    },
    phase:()=>room.connection()==='closed'?'closed':!game?'lobby':host?game.phase:remote.ph==='lobby'?'lobby':game.world?game.phase:remote.ph,
    lobby:()=>room.lobby(),
    setReady:v=>room.setReady(v),
    ready:()=>!!room.lobby().players.find(p=>p.you)?.ready,
    setSettings:s=>room.setSettings(s),
    setProfile:(p,a)=>room.setProfile(p,a),
    again(){if(host&&game){Game.startMatch(game);room.setMatch(true);flush();}},
    toLobby(){if(host){if(game)game.phase='lobby';room.setMatch(false);}},
    result:()=>game?.matchResult||null,
    async leave(){await room.leave();},
    dispose(){room.dispose();},
    closeReason:()=>room.closeReason(),
    stats:()=>({...room.stats(),budget:budget.slice()}),
  };
  return api;
}
module.exports={create,PROTOCOL,PURPOSE,SETTINGS};
