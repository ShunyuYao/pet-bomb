// Entry: menus, keyboard input, the fixed-step loop, HUD, and wiring of the rules (game/) to the
// view (scene.js) and — for LAN play — the room (game/net.js on pet-kit).
import {createWorld} from './scene.js';
import {createAudio} from './audio.js';
import * as C from '../vendor/pet-kit/looks.js';
import Config from '../game/config.cjs';
import Game from '../game/game.cjs';
import AI from '../game/ai.cjs';
import Sim from '../game/sim.cjs';
import Grid from '../game/grid.cjs';
import Net from '../game/net.js';

C.configureLooks({dbName:'pet-bomb'});
const $=id=>document.getElementById(id);
const world=createWorld($('stage'));
const KIND_LABEL={doll3d:'3D 布偶',sprite:'2D 立绘',toy:'内置形象'};
const MODE_LABEL={ffa:'大乱斗',team:'组队 2v2'},ROUNDS_LABEL={3:'3 局 2 胜',5:'5 局 3 胜'},ITEMS_LABEL={standard:'标准',advanced:'进阶'};
const CPU_LOOKS=[{species:'cat',color:'#8e7cff'},{species:'bunny',color:'#34c38f'},{species:'mouse',color:'#ffb020'},{species:'cat',color:'#ff7aa8'}];
const DEFAULT_PREFS={mode:'ffa',size:4,rounds:3,items:'advanced',cpuLevel:1,sfx:true};
const prefs=loadPrefs();
function loadPrefs(){try{return {...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('pet-bomb-prefs')||'{}')};}catch{return {...DEFAULT_PREFS};}}
function savePrefs(){try{localStorage.setItem('pet-bomb-prefs',JSON.stringify(prefs));}catch{}}
const audio=createAudio({sfx:prefs.sfx});
addEventListener('pointerdown',()=>audio.unlock(),{capture:true});addEventListener('keydown',()=>audio.unlock(),{capture:true});

let sdk=window.pet||null,driver=null,petDriver=null,realtimeNote='';
let session=null; // {kind:'solo'|'lan', game, step, ...}
let mode='title';
const peerAssets=new Map(); // signature → asset (LAN)

// ---------- UI helpers ----------
let errorTimer=null,announceTimer=null;
function show(panel){for(const id of ['title-panel','lobby-panel','round-panel','results-panel'])$(id).hidden=id!==panel;$('menu').hidden=!panel;}
function error(text){$('error').textContent=text||'';$('error').hidden=!text;clearTimeout(errorTimer);if(text)errorTimer=setTimeout(()=>{$('error').hidden=true;},7000);}
function announce(text,{small=false,ms=900}={}){const a=$('announce');a.textContent=text;a.classList.toggle('small',small);a.hidden=false;a.classList.remove('pop');void a.offsetWidth;a.classList.add('pop');clearTimeout(announceTimer);announceTimer=setTimeout(()=>{a.hidden=true;},ms);}
function describe(e){const m=e?.message||String(e);const map={no_invitation:'这份 HTML 还没有联机邀请。',protocol_mismatch:'双方的游戏版本不一致，请用同一份 HTML。',session_closed:'本次联机已结束。',room_full:'房间已经满 4 人了。',zip_invalid:'这个 ZIP 读不出来，请确认是完整的角色包。',pack_no_character:'包里没有 character.json，不像是桌宠角色包。',pack_no_frames:'角色包里没有找到 idle 动作图。',pack_realtime_invalid:'角色包里的 3D 布偶数据不完整。',image_decode_failed:'图片解码失败，换一张 PNG / WebP / JPG 试试。',file_too_large:'文件太大了（超过 12 MB）。',asset_too_large:'形象素材超过 1 MB，其他人会看到内置形象。',CHARACTER_IMAGE_UNAVAILABLE:'暂时读不到当前桌宠形象。',host_only:'只有房主可以修改。'};
  return map[m]||(/permission|denied|revoked/i.test(m)?'能力未授权：请重新打开 HTML 并允许读取形象 / 联机。':'出了点问题：'+m);}
function portraitInto(el,src,fallback='🐭'){el.replaceChildren();if(src){const img=new Image();img.src=src;img.alt='';el.append(img);}else el.textContent=fallback;}
const portraitOf=a=>a?.kind==='sprite'?a.frames[0]:a?.kind==='doll3d'?a.head:null;
const toyEmoji=a=>a?.species==='cat'?'🐱':a?.species==='bunny'?'🐰':'🐭';
function chipGroup(el,values,label,current,onPick,{disabled=false}={}){
  el.replaceChildren();
  for(const v of values){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.value=String(v);b.textContent=label(v);b.setAttribute('aria-pressed',String(v===current));b.disabled=disabled;b.addEventListener('click',()=>onPick(v));el.append(b);}
}
const colorOf=slot=>{const g=session?.game;if(g?.mode==='team'){const r=g.roster.find(x=>x.slot===slot);return Config.TEAMS[r?r.team:(Config.SPAWNS[slot][0]<Config.W/2?0:1)].color;}return Config.SLOT_COLORS[slot];};
function renderFighterCard(){
  portraitInto($('fighter-portrait'),driver?.portrait,toyEmoji(driver?.asset));
  $('fighter-name').textContent=driver?.profile.name||'…';
  $('fighter-kind').textContent=driver?KIND_LABEL[driver.profile.kind]:'';$('fighter-kind').dataset.kind=driver?.profile.kind||'';
  $('use-pet').hidden=!sdk?.character;$('use-pet').disabled=!petDriver;
  const usingPet=driver&&petDriver&&(driver.source==='pet'||driver.characterKey===petDriver.characterKey);
  $('pet-auto').hidden=!usingPet;$('pet-auto').textContent='已自动带入你的桌宠形象。'+(driver?.profile.kind==='sprite'&&realtimeNote?' '+realtimeNote:'');
}
function renderOptions(){
  for(const b of document.querySelectorAll('.mode-card'))b.setAttribute('aria-checked',String(b.dataset.mode===prefs.mode));
  chipGroup($('size-list'),prefs.mode==='team'?[4]:[2,3,4],v=>v+' 人',prefs.mode==='team'?4:prefs.size,v=>{prefs.size=v;savePrefs();renderOptions();});
  chipGroup($('rounds-list'),Config.MATCH.rounds,v=>ROUNDS_LABEL[v],prefs.rounds,v=>{prefs.rounds=v;savePrefs();renderOptions();});
  chipGroup($('items-list'),['advanced','standard'],v=>ITEMS_LABEL[v],prefs.items,v=>{prefs.items=v;savePrefs();renderOptions();});
  chipGroup($('cpu-list'),[0,1,2],v=>AI.LEVELS[v].name,prefs.cpuLevel,v=>{prefs.cpuLevel=v;savePrefs();renderOptions();});
}
for(const b of document.querySelectorAll('.mode-card'))b.addEventListener('click',()=>{prefs.mode=b.dataset.mode;savePrefs();renderOptions();});
$('sfx').addEventListener('click',()=>{prefs.sfx=!prefs.sfx;audio.setOn(prefs.sfx);savePrefs();$('sfx').textContent='音效 '+(prefs.sfx?'开':'关');$('sfx').setAttribute('aria-pressed',String(prefs.sfx));});
$('keys-btn').addEventListener('click',()=>toggleKeys());
function toggleKeys(force){const open=force??$('keys-panel').hidden;$('keys-panel').hidden=!open;$('keys-btn').setAttribute('aria-expanded',String(open));}

// ---------- characters ----------
async function setDriver(next){driver=next;renderFighterCard();session?.lan?.setProfile?.(profileOf(driver),driver.asset);syncPlayers();}
function profileOf(d){return {name:d.profile.name,signature:d.profile.signature,kind:d.profile.kind};}
async function importFiles(files){
  const list=[...files];if(!list.length)return;
  $('import-status').textContent='正在读取 '+(list[0].webkitRelativePath?.split('/')[0]||list[0].name)+' …';$('import-status').dataset.state='busy';
  try{
    let d;
    if(list.length>1||list[0].webkitRelativePath)d=await C.packDriver(list);
    else if(/\.zip$/i.test(list[0].name)||list[0].type==='application/zip')d=await C.packDriver(list[0]);
    else if(/^image\//.test(list[0].type)||/\.(png|webp|jpe?g|gif)$/i.test(list[0].name))d=await C.imageDriver(list[0]);
    else throw Error('请导入角色包 ZIP / 文件夹，或 PNG / WebP / JPG 图片。');
    if(d.characterKey)void C.saveDriver('pack:'+d.characterKey,d);
    await setDriver(d);void C.saveDriver('last',d);
    $('import-status').textContent='已导入「'+d.profile.name+'」 · '+KIND_LABEL[d.profile.kind];$('import-status').dataset.state='ok';
  }catch(e){console.error(e);$('import-status').textContent=describe(e);$('import-status').dataset.state='error';}
}
$('import-file').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
$('import-folder').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
addEventListener('dragover',e=>{e.preventDefault();if(mode!=='play')document.body.classList.add('dragging');});
addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});
addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');if(mode==='play')return;void importFiles(e.dataTransfer.files);});
for(const t of C.TOYS){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.toy=t.id;b.textContent=t.name;b.addEventListener('click',async()=>{await setDriver(await C.toyDriver(t.id));$('import-status').textContent='';});$('toy-row').append(b);}
$('use-pet').addEventListener('click',async()=>{if(petDriver)await setDriver(await preferRealtime(petDriver));});
async function preferRealtime(d){
  if(d?.source==='pet'&&sdk?.character?.getRealtime){
    try{const raw=await sdk.character.getRealtime(),rt=await C.realtimeDriver(raw,d);if(rt){realtimeNote='';return rt;}
      realtimeNote=raw?'这个形象的 3D 数据格式本游戏不认识，先以 2D 出战。':'这个形象没有 3D 布偶数据，以 2D 出战。';}
    catch(e){console.warn('realtime unavailable',e);realtimeNote='读取 3D 布偶数据失败，先以 2D 出战。';}
  }
  if(d?.characterKey){const cached=await C.loadDriver('pack:'+d.characterKey);if(cached?.asset.kind==='doll3d')return cached;}
  return d;
}
function grantState(text){$('grant-box').hidden=!text;$('grant-text').textContent=text||'';}
async function readPet(){
  grantState('正在请求读取你的桌宠形象：请在桌宠弹出的授权窗口里点「允许」。');
  let grant;try{grant=await sdk.capabilities.request({});}catch(e){grantState('授权请求没有完成（'+describe(e)+'），可以再试一次。');return false;}
  if(grant?.status!=='granted'||!grant.permissions?.includes('character:read')){grantState('还没有允许读取桌宠形象，现在先用内置形象。点下面的按钮可以重新授权。');return false;}
  try{petDriver=await C.currentPetDriver(sdk.character);}catch(e){grantState('已授权，但暂时读不到当前桌宠形象：'+describe(e));return false;}
  grantState('');await setDriver(await preferRealtime(petDriver));return true;
}
$('grant-retry').addEventListener('click',async()=>{if(await readPet())await joinInvitation();});

// ---------- players in the view ----------
// me = my driver; other humans = their transferred look (a toy until it arrives); computers = toys.
function lookOf(r,g){
  // Room does not transfer a recipient's own signature back to that recipient.
  // Another seat with the identical validated appearance can use the local data.
  if(driver&&(r.slot===g.mySlot||(r.kind!=='bot'&&r.signature===driver.profile.signature)))return {signature:driver.profile.signature,asset:driver.asset,fallback:driver.fallback};
  if(r.kind==='bot'){const look=CPU_LOOKS[r.slot%CPU_LOOKS.length];return {signature:'cpu:'+r.slot+look.species,asset:{kind:'toy',...look}};}
  const asset=peerAssets.get(r.signature);
  return {signature:asset?r.signature:'pending:'+r.signature,asset:asset||{kind:'toy',species:'mouse',color:colorOf(r.slot)}};
}
let rosterKey='';
function syncPlayers(force){
  const g=session?.game;
  if(!g||!g.world){world.removePlayer(1);world.removePlayer(2);world.removePlayer(3);if(driver)void world.setPlayer(0,{signature:driver.profile.signature,asset:driver.asset,fallback:driver.fallback,name:driver.profile.name,color:Config.SLOT_COLORS[0]});rosterKey='';return;}
  const key=JSON.stringify([g.mode,g.mySlot,g.roster.map(r=>[r.slot,r.kind,r.name,r.signature]),[...peerAssets.keys()],driver?.profile.signature]);
  if(key===rosterKey&&!force)return;rosterKey=key;
  const slots=new Set();
  for(const r of g.roster){slots.add(r.slot);void world.setPlayer(r.slot,{...lookOf(r,g),name:r.name,color:colorOf(r.slot)});}
  for(const p of world.info().players)if(!slots.has(p.slot))world.removePlayer(p.slot);
}

// ---------- input ----------
// Movement: the most recently pressed direction wins (SPEC §2).
const MOVE={KeyW:[0,-1],ArrowUp:[0,-1],KeyS:[0,1],ArrowDown:[0,1],KeyA:[-1,0],ArrowLeft:[-1,0],KeyD:[1,0],ArrowRight:[1,0]};
let held=[],placeQueued=false,needleQueued=false;
addEventListener('keydown',e=>{
  if(e.code==='KeyP'){toggleKeys();return;}
  if(mode!=='play')return;
  if(MOVE[e.code]||e.code==='Space'||e.code==='KeyJ'||e.code==='KeyK')e.preventDefault();
  if(e.repeat)return;
  if(MOVE[e.code]){held=held.filter(k=>k!==e.code);held.push(e.code);}
  if(e.code==='KeyJ'||e.code==='Space')placeQueued=true;
  if(e.code==='KeyK')needleQueued=true;
});
addEventListener('keyup',e=>{held=held.filter(k=>k!==e.code);});
addEventListener('blur',()=>{held=[];});
function readInput(){
  const k=held[held.length-1],[dx,dy]=k?MOVE[k]:[0,0];
  const input={dx,dy,place:placeQueued,needle:needleQueued};placeQueued=false;needleQueued=false;return input;
}

// ---------- solo ----------
function startSolo(){
  const g=Game.create({role:'solo',mySlot:0,mode:prefs.mode,rounds:prefs.rounds,items:prefs.items,cpuLevel:prefs.cpuLevel});
  const me={slot:0,name:driver?.profile.name||'我',owner:'local',signature:driver?.profile.signature};
  Game.setRoster(g,Game.fillBots([me],{mode:prefs.mode,size:prefs.size}));
  session={kind:'solo',game:g,step:(dt,input)=>{const ev=Game.step(g,dt,input);g.out.length=0;return ev;},again(){Game.startMatch(g);},leave(){}};
  Game.startMatch(g);g.out.length=0;syncPlayers(true);setConn('solo','单人练习');
}
$('solo').addEventListener('click',()=>{audio.unlock();startSolo();});
$('again').addEventListener('click',()=>{if(!session)return;if(session.kind==='solo')session.again();else session.lan.again();});
$('to-title').addEventListener('click',()=>{if(session?.kind==='lan'&&session.lan.isHost()){session.lan.toLobby();return;}leave();});
$('leave').addEventListener('click',()=>leave());
async function leave(){const s=session;session=null;try{await s?.leave?.();}catch{}held=[];renderMode(true);syncPlayers(true);}
function setConn(state,text){$('conn').hidden=!state;$('conn').dataset.state=state||'';$('conn').textContent=text||'';}

// ---------- LAN ----------
const CONN_TEXT={connected:'已联机',waiting:'等待连接',reconnecting:'正在重连',closed:'联机已结束'};
let feedQueue=[];
async function joinInvitation(){
  if(session||!sdk?.sessions?.getContext)return;
  let context=null;try{context=await sdk.sessions.getContext();}catch(e){if(!/permission|denied|revoked/i.test(e.message))error(describe(e));return;}
  if(!context)return;
  const lan=Net.create(sdk.sessions,{
    onLobby:()=>{if(mode==='lobby')renderLobby();},
    onAsset:(signature,asset)=>{if(!C.checkAsset(asset)){error('有位玩家的形象数据无效，已改用内置形象。');return;}peerAssets.set(signature,asset);syncPlayers(true);},
    onConnection:s=>setConn(s,CONN_TEXT[s]||s),
    onClosed:r=>{if(r==='room_full')error(describe(Error('room_full')));},
    onFeed:e=>feedQueue.push(e),
    onError:e=>{if(!/\b(backpressure|peer_offline|not_connected|quota_exceeded)\b/.test(e.message))error(describe(e));},
  });
  try{await lan.start(profileOf(driver),driver.asset);}catch(e){error(describe(e));return;}
  session={kind:'lan',lan,get game(){return lan.game;},step:(dt,input)=>{lan.step(dt,input);const ev=feedQueue;feedQueue=[];return ev;},leave:()=>lan.leave()};
  syncPlayers(true);
}

// ---------- mode / menus ----------
function phaseOf(){const g=session?.game;if(!session)return null;return session.kind==='lan'?session.lan.phase():g.phase;}
function computeMode(){
  const ph=phaseOf();if(!ph)return 'title';
  if(ph==='closed')return 'closed';if(ph==='lobby')return 'lobby';if(ph==='results')return 'results';if(ph==='round')return 'round';return 'play';
}
let renderedMode='';
function renderMode(force){
  mode=computeMode();if(!force&&mode===renderedMode)return;const prev=renderedMode;renderedMode=mode;
  document.body.classList.toggle('playing',mode==='play');
  $('hud').hidden=!['play','round'].includes(mode);$('leave').hidden=!session;
  if(mode==='title'||mode==='closed'){show('title-panel');renderOptions();}
  else if(mode==='lobby'){show('lobby-panel');renderLobby();}
  else if(mode==='round'){show('round-panel');renderRound();}
  else if(mode==='results'){show('results-panel');renderResults();}
  else{show(null);if(prev!=='play'){countdownShown=-1;held=[];}}
  if(mode!=='play'){held=[];$('hint').hidden=true;}
}
function renderLobby(){
  const lan=session?.lan;if(!lan)return;const L=lan.lobby(),host=L.host,st=L.settings;
  const cells=[0,1,2,3].map(slot=>{
    const p=L.players.find(x=>x.slot===slot),d=document.createElement('div');
    d.className='seat'+(p?.you?' you':'')+(p?'':' empty');if(st.mode==='team')d.dataset.team=String(Config.SPAWNS[slot][0]<Config.W/2?0:1);
    if(!p){d.textContent='空位 · 开局时由电脑补上';return d;}
    const mini=document.createElement('div');mini.className='mini';const a=p.you?driver?.asset:peerAssets.get(p.signature);portraitInto(mini,portraitOf(a)||(p.you?driver?.portrait:null),toyEmoji(a));
    const who=document.createElement('div');who.className='who';const n=document.createElement('strong');n.textContent=p.name+(p.slot===0?'（房主）':'')+(p.you?' · 我':'');
    const k=document.createElement('span');k.className='kind-tag small';k.dataset.kind=p.kind;k.textContent=KIND_LABEL[p.kind]||'';who.append(n,k);
    const r=document.createElement('span');r.className='rd'+(p.waiting?' wait':p.ready?' ok':'');r.textContent=p.waiting?'下一场上场':p.ready?'已准备':p.online===false?'掉线':'未准备';
    d.append(mini,who,r);return d;});
  $('seats').replaceChildren(...cells);
  const set=s=>{try{lan.setSettings(s);}catch(e){error(describe(e));}renderLobby();};
  chipGroup($('lobby-mode'),Config.MODES,v=>MODE_LABEL[v],st.mode,v=>set({mode:v}),{disabled:!host});
  chipGroup($('lobby-rounds'),Config.MATCH.rounds,v=>ROUNDS_LABEL[v],st.rounds,v=>set({rounds:v}),{disabled:!host});
  chipGroup($('lobby-items'),['advanced','standard'],v=>v==='advanced'?'进阶：踢水球、针':'标准',st.items,v=>set({items:v}),{disabled:!host});
  chipGroup($('lobby-cpu'),[0,1,2],v=>AI.LEVELS[v].name,st.cpu,v=>set({cpu:v}),{disabled:!host});
  $('host-hint').textContent=host?'':'（房主决定）';
  $('lobby-title').textContent='联机大厅 · '+MODE_LABEL[st.mode];
  $('ready').textContent=lan.ready()?'取消准备':'我准备好了';
  const me=L.players.find(p=>p.you);
  $('lobby-note').textContent=me?.waiting?'这一场已经开始，等打完回到大厅再上场。':L.players.length<2?'等朋友加入：在桌宠控制栏点「＋ 邀请」，最多 4 人。':'所有人都准备好就开始；不到 4 人时，空位由电脑补上。';
}
$('ready').addEventListener('click',()=>{const lan=session?.lan;if(!lan)return;lan.setReady(!lan.ready());renderLobby();});
function sideName(g,side){if(!side)return '平局';if(side[0]==='t')return Config.TEAMS[+side.slice(1)].name;const r=g.roster.find(x=>x.slot===+side.slice(1));return r?r.name:'?';}
function mySide(g){const r=g.roster.find(x=>x.slot===g.mySlot);if(!r)return null;return g.mode==='team'?'t'+r.team:'s'+r.slot;}
function pips(el,g,wins){
  el.replaceChildren();const firstTo=Config.MATCH.firstTo[g.rounds]||2;
  const sides=g.mode==='team'?['t0','t1']:g.roster.map(r=>'s'+r.slot);
  for(const s of sides){const span=document.createElement('span');span.style.color=s[0]==='t'?Config.TEAMS[+s.slice(1)].color:Config.SLOT_COLORS[+s.slice(1)];
    span.append(sideName(g,s)+' ');for(let i=0;i<firstTo;i++){const d=document.createElement('i');if(i<(wins[s]||0))d.className='f';span.append(d);}el.append(span);}
}
function statsTable(el,g,rows){
  const head='<tr><th>选手</th><th>困住对手</th><th>救出队友</th><th>戳破泡泡</th><th>冲开纸箱</th></tr>';
  el.innerHTML=head;
  for(const r of rows){const tr=document.createElement('tr');if(r.slot===g.mySlot)tr.className='you';
    const td0=document.createElement('td');const dot=document.createElement('span');dot.className='dot';dot.style.background=colorOf(r.slot);td0.append(dot,r.name);tr.append(td0);
    for(const k of ['traps','rescues','pops','crates']){const td=document.createElement('td');td.textContent=String(r[k]||0);tr.append(td);}el.append(tr);}
}
function renderRound(){
  const g=session.game,w=g.world;if(!w)return;
  const winner=w.result?.winner??null;
  $('round-eyebrow').textContent='ROUND '+g.round;
  $('round-title').textContent=!winner?'这一回合平局':winner===mySide(g)?(g.mode==='team'?'我们拿下这一回合':'你拿下这一回合'):sideName(g,winner)+' 拿下这一回合';
  const wins=session.kind==='lan'&&!session.lan.isHost()?(g.roundResults.reduce((a,s)=>{if(s)a[s]=(a[s]||0)+1;return a;},{})):g.match.wins;
  pips($('round-pips'),g,wins);
  statsTable($('round-stats'),g,g.roster.map(r=>({slot:r.slot,name:r.name,...(Sim.player(w,r.slot)?.stats||{})})));
  $('round-note').textContent='马上开始第 '+(g.round+1)+' 回合，换一张地图。';
  audio.play(winner&&winner===mySide(g)?'win':'lose');
}
function renderResults(){
  const g=session.game,r=(session.kind==='lan'?session.lan.result():g.matchResult)||{winner:null,wins:{},stats:[]};
  $('results-title').textContent=!r.winner?'整场平局':r.winner===mySide(g)?(g.mode==='team'?'我们赢了！':'你赢了！'):sideName(g,r.winner)+' 赢了';
  pips($('results-pips'),g,r.wins||{});statsTable($('results-stats'),g,r.stats||[]);
  const guest=session.kind==='lan'&&!session.lan.isHost();
  $('again').hidden=guest;$('to-title').textContent=session.kind==='lan'&&!guest?'回到大厅':'回到开始';
  $('results-note').textContent=guest?'等房主开始下一场。':'';
  audio.play(r.winner&&r.winner===mySide(g)?'win':'lose');
}

// ---------- HUD ----------
let countdownShown=-1,lastSec=-1;
const CARD_ORDER={l:[0,3],r:[2,1]};
function card(g,w,slot){
  const r=g.roster.find(x=>x.slot===slot),p=Sim.player(w,slot);if(!r||!p)return null;
  const d=document.createElement('div');d.className='card'+(slot===g.mySlot?' you':'')+(p.alive?'':' out');d.style.setProperty('--c',colorOf(slot));d.dataset.slot=String(slot);
  const hd=document.createElement('div');hd.className='hd';const mini=document.createElement('div');mini.className='mini';const look=lookOf(r,g).asset;
  portraitInto(mini,slot===g.mySlot?driver?.portrait:portraitOf(look),toyEmoji(look));
  const nm=document.createElement('div');const b=document.createElement('b');b.textContent=r.name;const tag=document.createElement('span');tag.className='tag';tag.textContent=g.mode==='team'?Config.TEAMS[r.team].name:r.kind==='bot'?'电脑':'玩家';nm.append(b,tag);hd.append(mini,nm);
  const st=document.createElement('div');st.className='st';
  for(const [v,label] of [[p.bombs,'水球'],[p.fire,'水量'],[p.shoes+1,'速度']]){const c=document.createElement('div');c.textContent=String(v);const s=document.createElement('small');s.textContent=label;c.append(s);st.append(c);}
  const ex=document.createElement('div');ex.className='ex';for(const [on,label] of [[p.kick,'踢'],[p.needles>0,'针 '+p.needles]]){const s=document.createElement('span');s.dataset.on=String(!!on);s.textContent=label;ex.append(s);}
  d.append(hd,st,ex);
  if(!p.alive){const s=document.createElement('div');s.className='state';s.textContent='出局';d.append(s);}
  else if(p.trapped){const s=document.createElement('div');s.className='state';s.dataset.trapped='true';s.textContent='被困 · '+Math.max(0,(p.trapped.until-w.t)/1000).toFixed(1)+' 秒';d.append(s);}
  return d;
}
let lastCards='';
function hud(g){
  const w=g.world;if(!w)return;
  const wins=session.kind==='lan'&&!session.lan.isHost()?g.roundResults.reduce((a,s)=>{if(s)a[s]=(a[s]||0)+1;return a;},{}):g.match.wins;
  const score=$('score');score.replaceChildren();
  const sides=g.mode==='team'?['t0','t1']:g.roster.map(r=>'s'+r.slot);
  for(const s of sides){const sp=document.createElement('span');sp.style.color=s[0]==='t'?Config.TEAMS[+s.slice(1)].color:Config.SLOT_COLORS[+s.slice(1)];sp.textContent=(g.mode==='team'?sideName(g,s)+' ':'●')+(wins[s]||0);sp.style.marginRight='8px';score.append(sp);}
  const left=w.t<0?w.playMs:Math.max(0,w.playMs-w.t),sec=Math.ceil(left/1000);
  $('timer').textContent=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');$('timer').dataset.low=String(w.t>=0&&left<=10000);
  $('round-no').textContent='第 '+g.round+' 回合 · '+ROUNDS_LABEL[g.rounds];
  const toSd=(w.suddenAtMs-w.t)/1000;
  if(w.t>=0&&toSd>0&&toSd<=20){$('sd').hidden=false;$('sd').dataset.now='false';$('sd').textContent=Math.ceil(toSd)+' 秒后外圈开始落书';}
  else if(w.t>=w.suddenAtMs&&!w.result){$('sd').hidden=false;$('sd').dataset.now='true';$('sd').textContent='外圈正在落书！';}
  else $('sd').hidden=true;
  // Side cards (rebuilt only when something on them changes).
  const key=JSON.stringify(w.players.map(p=>[p.slot,p.alive,p.bombs,p.fire,p.shoes,p.kick,p.needles,p.trapped?Math.ceil((p.trapped.until-w.t)/100):0]))+rosterKey;
  if(key!==lastCards){lastCards=key;for(const side of ['l','r'])$('side-'+side).replaceChildren(...CARD_ORDER[side].map(s=>card(g,w,s)).filter(Boolean));}
  if(w.t<0){const n=Math.ceil(-w.t/1000);if(n!==countdownShown&&n>0&&n<=3){countdownShown=n;announce(String(n));audio.play('beep');}}
  else if(countdownShown>0){countdownShown=0;announce('开始！',{ms:700});audio.play('go');}
  if(w.t>=0&&left<=10000&&sec!==lastSec){lastSec=sec;audio.play('tick');}
  const me=Sim.player(w,g.mySlot);
  const hint=$('hint');
  if(me&&me.alive&&me.trapped){hint.hidden=false;hint.textContent=me.needles>0?'被困住了！按 K 用针自救':g.mode==='team'?'被困住了！等队友来碰你一下':'被困住了！快躲开对手';}
  else if(me&&!me.alive&&!w.result){hint.hidden=false;hint.textContent='你出局了，看看别人怎么打';}
  else if(!me&&w.t>=0){hint.hidden=false;hint.textContent='观战中：下一场上场';}
  else hint.hidden=true;
}
function onEvents(g,events){
  for(const e of events){
    if(e.type==='place')audio.play('place');
    else if(e.type==='burst')audio.play('burst');
    else if(e.type==='trap')audio.play('trap');
    else if(e.type==='out'&&e.why==='pop')audio.play('pop');
    else if(e.type==='free')audio.play('free');
    else if(e.type==='pick'&&e.slot===g.mySlot)audio.play('pick');
    else if(e.type==='kick')audio.play('kick');
    else if(e.type==='book')audio.play('book');
    else if(e.type==='round')syncPlayers(true);
  }
}

// ---------- loops ----------
// Simulation: fixed 60 Hz on wall time (setInterval keeps running when the window is covered).
const STEP=1000/60;let acc=0,lastT=performance.now();
setInterval(()=>{
  try{
    const t=performance.now();acc=Math.min(acc+(t-lastT),500);lastT=t;
    const s=session;if(!s){acc=0;return;}
    while(acc>=STEP){acc-=STEP;const input=mode==='play'?readInput():{dx:0,dy:0};const ev=s.step(STEP,input);if(s.game)onEvents(s.game,ev||[]);}
  }catch(e){console.error(e);error(describe(e));}
},1000/120);
let lastFrame=performance.now(),lastLobby=0,idle=null;
function idleWorld(){if(!idle){idle=Sim.createWorld({seed:20260928,roster:[{slot:0}]});idle.t=1;}return idle;}
function frame(now){
  const dt=Math.min(0.1,(now-lastFrame)/1000);lastFrame=now;
  try{
    renderMode();if(mode==='lobby'&&now-lastLobby>400){lastLobby=now;renderLobby();}
    if(mode==='closed'&&session){const s=session;session=null;error(s.lan.closeReason()==='left'?'':'联机已结束：房主离开或连接断开。');renderMode(true);syncPlayers(true);}
    const g=session?.game;
    if(g?.world){syncPlayers();world.render(dt,{world:session?.lan?.renderWorld()||g.world,colorOf});if(mode==='play'||mode==='round')hud(g);if(mode!=='play')$('hint').hidden=true;}
    else world.render(dt,{world:idleWorld(),colorOf:()=>Config.SLOT_COLORS[0]});
  }catch(e){console.error(e);}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- test / diagnostics hook (read-only view of the state) ----------
window.__bomb={
  state:()=>{const g=session?.game,w=g?.world,me=w&&Sim.player(w,g.mySlot);return {mode,driver:driver?{kind:driver.profile.kind,name:driver.profile.name}:null,session:session?.kind||null,
    phase:phaseOf(),round:g?.round||0,t:w?Math.round(w.t):null,mySlot:g?.mySlot??null,
    me:me?{x:me.x,y:me.y,alive:me.alive,trapped:!!me.trapped,bombs:me.bombs,fire:me.fire,shoes:me.shoes,kick:me.kick,needles:me.needles}:null,
    players:w?w.players.map(p=>({slot:p.slot,x:p.x,y:p.y,alive:p.alive,trapped:!!p.trapped,kind:p.kind})):[],
    balloons:w?w.balloons.map(b=>({id:b.id,x:b.x,y:b.y,owner:b.owner})):[],
    hash:w?Grid.hash(w.cells,w.lying):null,result:g?(session.kind==='lan'?session.lan.result():g.matchResult):null,roundResult:w?.result||null,
    lobby:session?.lan?session.lan.lobby().players.map(p=>({slot:p.slot,name:p.name,kind:p.kind,ready:p.ready,you:p.you})):null,
    audio:audio.state(),net:session?.lan?.stats?.()||null};},
  world:()=>world.info(),
  screen:(gx,gy)=>world.project(gx,gy),
  cell:(x,y)=>{const w=session?.game?.world;return w?{cell:w.cells[y*Config.W+x],item:w.lying[y*Config.W+x]}:null;},
};

// ---------- boot ----------
(async()=>{
  renderOptions();
  driver=await C.loadDriver('last')||await C.toyDriver('mouse');renderFighterCard();syncPlayers(true);
  $('env-note').textContent=sdk?'在桌宠里打开：会自动带入你的桌宠。和朋友一起玩：在桌宠里「发送并一起玩」这份 HTML。':'普通浏览器打开：可以单人练习；导入角色包或图片可以换形象。';
  if(sdk?.character&&await readPet())await joinInvitation();
  else if(sdk?.sessions)await joinInvitation();
})().catch(e=>{console.error(e);error(describe(e));});
