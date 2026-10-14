'use strict';
// Actual production UDP discovery, real file-send control and byte delivery,
// Real invitation/capability consent and production TLS; legacy hosts also show pairing codes.
// No invitation fixture, trust seeding, mock broker or synthesized game results.
// Hidden windows/real CDP keys prove business behavior, not native OS focus or
// physical two-computer networking. Only OS keystore is a disposable AES fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const GAME = path.resolve(__dirname, '..');
// Local fixture: a directory with rat-doll-{female,male}.zip character packs (not published).
const PACKS = process.env.BOMB_PACKS_DIR || path.resolve(GAME, '../rat-doll-lab/dist');
const HOST = process.env.BOMB_HOST_ROOT || path.resolve(GAME, '../..');
assert(fs.existsSync(path.join(HOST,'demo/core/peer-session/contracts.js')), 'Set BOMB_HOST_ROOT to the host checkout containing pet.sessions');
const H = require(path.join(HOST, 'tests/e2e-helpers'));
const electron = require(path.join(HOST, 'demo/node_modules/electron'));
const charIds = ['rat-doll-female', 'rat-doll-male'];
const F = require(path.join(HOST, 'tests/helpers/lan-appearance-fixture'));
const { activateButton, activateClosingButton } = require(path.join(HOST, 'tests/e2e/html-card-input'));
const source = process.env.MOTION_HTML || path.join(GAME, 'dist/桌宠水球大作战.html');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-plugin-appearance-peer-delivery-'));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(GAME, 'artifacts/host-e2e', runId);
const bootstrap = path.join(H.REPO, 'tests/helpers/peer-session-delivery-bootstrap.js');
const report = { runId, root, scope: 'Actual three hidden production hosts (room of host + 2 guests) over loopback UDP/TCP/TLS. OS keystore is test AES-GCM only; native Keychain and two physical machines are not covered.', checks: [], failures: [], screenshots: [], dialogs: [], sdkGrants: [], exceptions: [] };
const apps = [], sockets = [];
const mode=process.argv.includes('--mixed')?'mixed':process.argv.includes('--relay')?'relay':'lan';
const playerCount=process.env.MOTION_AUDIT||process.argv.includes('--four')?4:3;
assert(!(process.argv.includes('--mixed')&&process.argv.includes('--relay')),'choose one network mode');
report.mode=mode;report.playerCount=playerCount;report.scope='Actual '+playerCount+' hidden production hosts over '+mode+' (loopback) with real invite, TLS consent, current pets and CDP input; synthetic relay tickets and isolated AES keystore only; not physical internet proof.';
let runtime,relay,mandatory;
const labels=['a','b','c','d'].slice(0,playerCount);
const isRelay=app=>mode==='relay'||mode==='mixed'&&app.label==='b';
const peerId=app=>isRelay(app)?'relay:'+relay.uid(app.label):app.deviceId;
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(label, detail) { report.checks.push({ label, pass: true, ...(detail === undefined ? {} : { detail }) }); console.log('PASS', label); }
async function wait(fn, label, ms = 30000) { const until = Date.now() + ms; let last; while (Date.now() < until) { try { const value = await fn(); if (value) return value; last = value; } catch (e) { last = e.message; } await H.sleep(100); } throw Error('Timeout: ' + label + '; last=' + JSON.stringify(last)); }
const targets = app => fetch(`http://127.0.0.1:${app.cdp}/json`).then(r => r.json());
const activity = app => { const file = path.join(app.profile, 'activity-hub.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { records: [] }; };
const state = app => H.evalIn(app.game, 'window.__bomb.state()');
const world = app => H.evalIn(app.game, 'window.__bomb.world()');
async function screenshot(page, name) { await H.cdp(page, 'Page.captureScreenshot', {format:'png'}); await H.evalIn(page, 'document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); const result = await H.cdp(page, 'Page.captureScreenshot', { format: 'png' }); const file = path.join(evidence, name + '.png'); fs.writeFileSync(file, Buffer.from(result.data, 'base64')); report.screenshots.push(file); }
async function watch(page, label) { const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ label, details: m.params.exceptionDetails }); }; ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' })); sockets.push(ws); }
async function key(page, code, type = 'keyDown') { const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code; await H.cdp(page, 'Input.dispatchKeyEvent', { type, key, code, ...(code === 'ArrowDown' ? { windowsVirtualKeyCode: 40 } : code === 'Space' ? { windowsVirtualKeyCode: 32 } : code === 'Enter' ? { text: '\r', windowsVirtualKeyCode: 13 } : {}) }); }
async function focus(page, selector) { await H.cdp(page, 'Emulation.setFocusEmulationEnabled', { enabled: true }); assert.equal(await H.evalIn(page, `document.querySelector(${JSON.stringify(selector)}).focus();document.activeElement.matches(${JSON.stringify(selector)})`), true); }
async function input(page, selector, text) { await focus(page, selector); await H.cdp(page, 'Input.insertText', { text }); assert.equal(await H.evalIn(page, `document.querySelector(${JSON.stringify(selector)}).value`), text); }
async function boot(label, discovery, peerDiscoveries) {
  const app = { label, profile: path.join(root, label), deviceId: crypto.randomUUID(), name: 'Peer delivery ' + label, cdp: await F.freePort() };
  apps.push(app); fs.mkdirSync(app.profile);if(relay){app.uid=relay.uid(label);relay.prepare(app.profile,label,labels);}
  json(path.join(app.profile, 'device.json'), { deviceId: app.deviceId, name: app.name });
  json(path.join(app.profile, 'friends.json'), { friends: [], pending: [], outgoing: [] });
  json(path.join(app.profile, 'settings-privacy.json'), { version: 1, usageStatsEnabled: false, doNotDisturb: false, verboseLogging: false });
  json(path.join(app.profile, 'config.json'), { character: label === 'a' ? 'qiqi' : 'nienie', petName: app.name,
    me: { petId: 'peer_delivery_' + label }, onboarding: { completed: true },
    behavior: { idleStroll: false, autoSleep: false, edgeSnap: false, petSize: 220 },
    crossScreen: { lanEnabled:mode==='lan'||mode==='mixed'&&label!=='b',allowDirectVisits: true, requireVisitConfirmation: false },
    relay: { url: 'ws://127.0.0.1:1', paired: {} }, general: { autoCheckUpdates: false }, tts: { enabled: false },
    plugins: { developerMode: false, registrySources: ['http://127.0.0.1:1/registry.json'] } });
  app.env = { ...process.env,...(mandatory?.env||{}),...(relay?relay.env(label):{}), ELECTRON_RUN_AS_NODE: undefined, PET_USERDATA_DIR: app.profile,
    PET_E2E_TEST: '1', PET_E2E_HIDDEN: '1', PET_E2E_BACKGROUND: '1', PET_DND_TRIGGER_COUNT: '999',
    PET_ACCOUNT_API_BASE: 'http://127.0.0.1:1', PET_ACTIVITY_BRIDGE_PORT: '0',
    PET_LAN_DISCOVERY_PORT: String(discovery), PET_LAN_DISCOVERY_TARGETS: [].concat(peerDiscoveries).map(p => '127.0.0.1:' + p).join(','),
    PET_E2E_LAN_TCP_PORT: String(await F.freePort()), PET_E2E_TF_PORT: String(await F.freePort()) };
  return launch(app);
}
async function launch(app) {
  app.run = { label: app.label + '-run-' + ((app.runs?.length || 0) + 1) }; (app.runs ||= []).push(app.run);
  app.run.native = path.join(evidence, app.run.label + '-native.jsonl'); fs.writeFileSync(app.run.native, '');
  app.child = spawn(electron, ['--require', bootstrap, runtime.demo, `--remote-debugging-port=${app.cdp}`, '--use-mock-keychain', '--mute-audio'], { cwd: runtime.demo, env: { ...app.env, PET_PUBLIC_NATIVE_LOG: app.run.native }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  app.run.pid = app.child.pid; app.child.log = ''; app.child.stdout.on('data', x => { app.child.log += x; }); app.child.stderr.on('data', x => { app.child.log += x; });
  if(mandatory)await mandatory.login(app.cdp,'1997777666'+(app.label.charCodeAt(0)-96));
  app.pet = await H.findTarget(app.cdp, '/index.html');
  await wait(() => H.evalIn(app.pet, 'typeof currentCharKey==="string" && !!frames.idle?.[0]?.[0]?.naturalWidth'), 'real pet decoded ' + app.label);
  await wait(async () => (await H.evalIn(app.pet, H.CANVAS_PIXELS)) > 100, 'real pet painted ' + app.label);
  await watch(app.pet, app.run.label + '-pet');
  app.overlay = await H.findTarget(app.cdp, '/pet-overlay.html'); await wait(() => H.evalIn(app.overlay, 'typeof petOverlayAPI === "object"'), 'overlay preload ready');
  await screenshot(app.pet, app.run.label + '-pet'); return app;
}
async function stop(app) {
  if (!app.child) return;
  const child = app.child;if(child.exitCode===null&&child.signalCode===null)H.kill(child);
  await wait(() => { try { process.kill(child.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } }, 'owned host stopped ' + app.label, 10000);
  fs.writeFileSync(path.join(evidence, app.run.label + '-host.log'), child.log); app.run.exited = true; app.child = null;
}
async function nearby(a, b) { return wait(async () => { const rows = await H.evalIn(a.pet,isRelay(b)?'petAPI.friendsOnlineGet()':'petAPI.lanGetDevices()');return rows.find(r=>r.deviceId===peerId(b)&&!r.offline); }, 'actual UDP discovered receiver'); }
async function sendGame(a, b, {share = false} = {}) {
  b.priorHostPeerIds=[];
  const previous = new Set(activity(b).records.map(r => r.id));
  const peer = await nearby(a, b); report.discovery = peer;
  await H.evalIn(a.pet, 'petAPI.openDashboard();true'); a.dashboard = await H.findReadyTarget(a.cdp, '/dashboard.html', 'dashboard');
  await wait(() => H.evalIn(a.dashboard, '!!document.querySelector("[data-action=resident-errand], .lan-row[data-via=lan] .lan-errand")'), 'real send entry ready');
  if(await H.evalIn(a.dashboard,'!!document.querySelector("[data-action=resident-errand]")')) {
    await activateButton(a.dashboard,'[data-action=resident-errand]');
    const recipient='[data-friend="'+peerId(b)+'"]';
    await wait(()=>H.evalIn(a.overlay,'!!document.querySelector('+JSON.stringify(recipient)+')'),'real discovered recipient');
    if(!await H.evalIn(a.overlay,'document.querySelector('+JSON.stringify(recipient)+').getAttribute("aria-pressed")==="true"'))await activateButton(a.overlay,recipient);
    // Only this recipient: other discovered devices are invited later from the game's control bar.
    for(const other of apps.filter(x=>x!==a&&x!==b)){const sel='[data-friend="'+peerId(other)+'"]';if(await H.evalIn(a.overlay,'document.querySelector('+JSON.stringify(sel)+')?.getAttribute("aria-pressed")==="true"'))await activateButton(a.overlay,sel);}
  } else {
    await activateClosingButton(a.cdp, a.dashboard, '.lan-row[data-via="lan"] .lan-errand');
  }
  await wait(() => H.evalIn(a.overlay, '!!document.querySelector("#errand-card")'), 'real send card');
  await activateButton(a.overlay, '#errand-card [data-tab="file"]');
  const point = await wait(() => H.evalIn(a.overlay, '(()=>{const e=document.querySelector("#ec-dropzone");if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()'), 'file tab dropzone painted');
  // CDP drag uses actual OS file paths. These are drag target coordinates, never
  // synthesized mouse clicks or pet-window hit-testing.
  const data = { items: [{ mimeType: 'text/html', data: '', title: path.basename(source), baseURL: '' }], files: [source], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await H.cdp(a.overlay, 'Input.dispatchDragEvent', { type, ...point, data });
  await wait(() => H.evalIn(a.overlay, `document.querySelector('#ec-dropzone .ec-attachment strong')?.textContent===${JSON.stringify(path.basename(source))}`), 'real file selected');
  await input(a.overlay, '#ec-input', '一起玩水球'); await activateButton(a.overlay, '#ec-go');
  const sendDialog = await wait(async () => { for(const page of (await targets(a)).filter(t=>t.url.includes('/dialog.html'))){const init=await H.evalIn(page,'dialogAPI.getInit()',3000).catch(()=>null);if(init?.peerSessionKind==='send'&&await H.evalIn(page,'!!document.querySelector(".btn-primary") && document.body.innerText.length>10'))return page;}return null; }, 'real send versus share choice');
  await screenshot(sendDialog, share?'send-share-only':'send-and-play'); await activateClosingButton(a.cdp,sendDialog,share?'.btn-secondary':'.btn-primary');
  const incoming = await wait(async () => {
    const record=activity(b).records.find(r => !previous.has(r.id) && r.direction === 'incoming' && r.file?.name === path.basename(source) && r.file.savedPath && fs.existsSync(r.file.savedPath));
    if(record)return record;
    const text=await H.evalIn(a.overlay,'document.querySelector("#errand-card")?.innerText||""');
    return text.includes('发送失败')?{deliveryFailure:text}:null;
  }, 'real received HTML saved', 45000);
  assert(!incoming.deliveryFailure,incoming.deliveryFailure);
  assert.equal(hash(incoming.file.savedPath), hash(source)); assert(incoming.file.htmlWork?.id); report.incoming = incoming;
  check('real send controls deliver identical HTML bytes and persist the received work', { id: incoming.id, artifactHash: incoming.file.htmlWork.id });
  const receipt = await wait(async () => { for (const page of (await targets(b)).filter(t => t.url.includes('/dialog.html'))) if (await H.evalIn(page, '!!document.querySelector("[data-work-open]")').catch(() => false)) return page; return null; }, 'real work receipt');
  assert(!(await targets(b)).some(t => t.url.startsWith('pet-work:') && !t.url.includes('thumbnail=1')), 'receipt must not execute before opening');
  await screenshot(receipt, 'received-game-before-open');
  await activateClosingButton(b.cdp, receipt, '[data-work-open]');
}
// Every message the game shows in its error bar (it auto-hides after 7 s, so record rather than poll).
const recordErrors=page=>H.evalIn(page,'(()=>{if(window.__errorsSeen)return true;window.__errorsSeen=[];const e=document.getElementById("error");new MutationObserver(()=>{if(!e.hidden&&e.textContent)window.__errorsSeen.push(e.textContent);}).observe(e,{attributes:true,childList:true,characterData:true,subtree:true});return true;})()');
async function assertNoErrors(apps,label){for(const app of apps){const seen=await H.evalIn(app.game,'window.__errorsSeen||[]');assert.deepEqual(seen,[],label+': error bar on '+app.label);}}
function classifyDialog(init, text) {
  if (['pair', 'accept'].includes(init.peerSessionKind)) return init.peerSessionKind;
  if (text.includes('请求桌宠能力')) return 'sdk';
  if (/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i.test(text)) return 'pair';
  if (/加入.*(?:对局|游戏)|接受.*邀请|邀请.*联机|一起.*玩|联机邀请/.test(init.title || text)) return 'accept';
  return null;
}
const manualPairing=!fs.readFileSync(path.join(HOST,'demo/core/peer-session/broker.js'),'utf8').includes('if(code)raw.confirm(code)');
async function approvals(a, b, expectPair = manualPairing) {
  const seen = new Set(), pairing = new Map(); let accepted = 0, sdk = 0, paired = false;
  await wait(async () => {
    for (const app of [a, b]) for (const page of (await targets(app)).filter(t => t.url.includes('/dialog.html') && !seen.has(t.id))) {
      const init = await H.evalIn(page, 'dialogAPI.getInit()', 3000).catch(() => null); if (!init) continue;
      const text = await H.evalIn(page, 'document.body.innerText'); if(!text.trim())continue; const kind = classifyDialog(init, text); if (!kind || kind==='pair'&&!/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i.test(text)) continue;
      seen.add(page.id); report.dialogs.push({ app: app.label, kind, title: init.title, text }); await screenshot(page, app.label + '-' + kind + '-' + seen.size);
      if (kind === 'pair') { assert(expectPair, 'trusted peers must not pair again'); pairing.set(app.label, { app, page, code: text.match(/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i)[0].replaceAll(' ', '').replaceAll('-', '').toLowerCase() }); }
      else { if (kind === 'sdk') {sdk++;report.sdkGrants.push(app.label);} else accepted++; await activateClosingButton(app.cdp, page, '.btn-primary'); }
    }
    if (pairing.size === 2 && !paired) { const [left, right] = [...pairing.values()]; assert.equal(left.code, right.code); assert.equal(left.code.length, 16); await activateClosingButton(left.app.cdp, left.page, '.btn-primary'); await activateClosingButton(right.app.cdp, right.page, '.btn-primary'); paired = true; check('both independently presented TLS pairing codes match before explicit confirmations'); }
    const pages = await Promise.all([a, b].map(async app => { const page = (await targets(app)).find(t => t.url.startsWith('pet-work:') && !t.url.includes('thumbnail=1')); if (!page) return null; if(app.game?.id!==page.id){app.game=page;await H.cdp(page,'Emulation.setFocusEmulationEnabled',{enabled:true});await H.cdp(page,'Page.captureScreenshot',{format:'png'});await recordErrors(page);} const ready = await H.evalIn(page, '(()=>{const s=window.__bomb?.state();return s?.session==="lan"&&s.mode==="lobby"&&!document.querySelector("#lobby-panel").hidden&&document.querySelectorAll("#seats .seat.you").length===1;})()', 3000).catch(() => false); if (ready) { app.game = page; return page; } return null; }));
    if(!pages.every(Boolean)||expectPair&&!paired)return false;
    for(const app of [a,b])if((await state(app)).net?.connection!=='connected')return false;return true;
  }, 'invitation, first pairing, SDK permission and current pets', 65000);
  assert(accepted >= 1, 'recipient must accept each game invitation'); assert(!expectPair || paired); assert([a.label,b.label].every(label=>report.sdkGrants.includes(label)), 'both fresh hosts require explicit SDK consent, including initial share-only approval');
  for (const app of [a, b]) { await watch(app.game, app.label + '-game'); assert.equal(await H.evalIn(app.game, '!document.querySelector("#server-address,#room-code") && document.querySelector("#title-panel").hidden'), true); const context = await H.evalIn(app.game, 'pet.sessions.getContext()'); assert.equal(context.role, app === a ? 'host' : 'guest'); assert.equal(context.artifactHash, hash(source)); app.context = context; }
  // The host context keeps the first invitation; each later guest has its own, listed in the host's peers.
  if (a.context.peers.length === 1) assert.equal(a.context.invitationId, b.context.invitationId);
  assert.equal(a.context.maxPlayers, 4); assert.equal(b.context.maxPlayers, 4);
  // Relay capability info intentionally carries device/fingerprint, not a
  // display name. Bind the new connected session ID, never a LAN name assumption.
  const prior=new Set(b.priorHostPeerIds||[]),added=a.context.peers.filter(p=>!prior.has(p.sessionPeerId));
  assert.equal(added.length,1,'exactly the invited guest adds a new host session');
  assert.equal(added[0].status,'connected','host lists the new guest as connected');
  b.hostSessionPeerId=added[0].sessionPeerId;
  (report.sessionBindings||=[]).push({guest:b.label,invitationId:b.context.invitationId,hostPeer:added[0]});
  check('real invite binds ' + b.label + ' to the host room: exact artifact, host referee, guest seat');
}
async function installAppearances(app) {
  await H.evalIn(app.pet, 'petAPI.openSettings("plugins");true');
  app.settings = await H.findReadyTarget(app.cdp, '/settings.html', 'settings');
  for (const id of charIds) {
    const archive = path.join(PACKS, id + '.zip');
    await H.evalIn(app.settings, `window.goldInstall=null;settings.pluginsInstallZip(${JSON.stringify(archive)}).then(r=>window.goldInstall=r);true`);
    await wait(async () => {
      const result = await H.evalIn(app.settings, 'window.goldInstall');
      if (result) { assert(result.ok, JSON.stringify(result)); return true; }
      for (const page of (await targets(app)).filter(t => t.url.includes('/dialog.html'))) {
        if (await H.evalIn(page, '!!document.querySelector(".btn-primary")').catch(() => false)) await activateClosingButton(app.cdp, page, '.btn-primary');
      }
      return false;
    }, 'appearance ZIP install ' + id);
  }
  const installed = await H.evalIn(app.settings, 'settings.pluginsList()');
  assert.deepEqual(installed.map(p => p.id).sort(), charIds.slice().sort());
  assert(installed.every(p => p.version === JSON.parse(fs.readFileSync(path.join(PACKS, '../exports/plugins', p.id, 'manifest.json'))).version));
  check(app.label + ' installs both current appearance packages; game is not installed', installed.map(p => ({ id:p.id, version:p.version })));
}
async function applyMain(app, id) {
  await H.evalIn(app.settings, `settings.pluginsTogglePanel(${JSON.stringify(id)});true`);
  const page = await H.findReadyTarget(app.cdp, '/' + id + '/panel.html', 'pet');
  await wait(() => H.evalIn(page, 'document.querySelector("#actor").naturalWidth>0 && document.querySelector("#companion").textContent!=="—"'), 'appearance ready');
  if (await H.evalIn(app.pet, `currentCharKey!==${JSON.stringify(id)}`)) await activateButton(page, '#apply');
  await wait(() => H.evalIn(app.pet, `currentCharKey===${JSON.stringify(id)} && !!frames.idle?.[0]?.[0]?.naturalWidth`), 'main pet applied');
  assert(await H.evalIn(app.pet, H.CANVAS_PIXELS) > 100);
  await screenshot(app.pet, 'main-' + app.label + '-' + id);
  await activateClosingButton(app.cdp, page, '#close');
}
async function closeWork(app) {
  const controls = await H.findTarget(app.cdp, '/work-player.html');
  await activateClosingButton(app.cdp, controls, '[data-work-exit]');
}
// ---------------- game-specific ----------------
async function inviteFromControls(a,c){
  // The host's work-player control bar ("+ Invite n/4") invites a third device into the open room.
  c.priorHostPeerIds=(await H.evalIn(a.game,'pet.sessions.getContext()')).peers.map(p=>p.sessionPeerId);
  const previous=new Set(activity(c).records.map(r=>r.id));
  const controls=await H.findTarget(a.cdp,'/work-player.html');
  await wait(async()=>{const b=await H.evalIn(controls,'(()=>{const b=document.querySelector("[data-work-invite]");return b&&!b.disabled&&b.textContent})()');return b&&b.includes((apps.filter(x=>x.game).length)+'/4');},'host invite control enabled below capacity');
  await screenshot(controls,'10-host-controls-before-'+c.label);
  const gameId=a.game.id,origin=await H.evalIn(a.game,'performance.timeOrigin');
  await activateButton(controls,'[data-work-invite]');
  const picker=await wait(async()=>{for(const page of (await targets(a)).filter(t=>t.url.includes('/dialog.html'))){const init=await H.evalIn(page,'dialogAPI.getInit()',3000).catch(()=>null);if(init?.peerSessionKind==='room-invite'&&await H.evalIn(page,'!!document.querySelector(".btn-primary")'))return page;}return null;},'device picker');
  const text=await H.evalIn(picker,'document.body.innerText');assert(text.includes(c.name)&&!text.includes(apps[1].name),'picker offers only devices not yet in the room');
  const device=peerId(c),init=await H.evalIn(picker,'dialogAPI.getInit()');const index=init.buttons.findIndex(b=>b.action==='device:'+device);assert(index>=0,'intended peer offered by real picker');
  report.inviteOptions=(report.inviteOptions||[]).concat({guest:c.label,via:isRelay(c)?'relay':'lan',buttons:init.buttons});
  const selector='.btn-row button:nth-child('+(index+1)+')';assert.equal(await H.evalIn(picker,`document.querySelector(${JSON.stringify(selector)}).textContent`),c.name);
  await screenshot(picker,'11-room-invite-picker-'+c.label);await activateClosingButton(a.cdp,picker,selector);
  const incoming=await wait(()=>activity(c).records.find(r=>!previous.has(r.id)&&r.direction==='incoming'&&r.file?.name===path.basename(source)&&r.file.savedPath&&fs.existsSync(r.file.savedPath)),'third device receives the same HTML',45000);
  assert.equal(hash(incoming.file.savedPath),hash(source));
  const receipt=await wait(async()=>{for(const page of (await targets(c)).filter(t=>t.url.includes('/dialog.html')))if(await H.evalIn(page,'!!document.querySelector("[data-work-open]")').catch(()=>false))return page;return null;},'work receipt on c');
  await activateClosingButton(c.cdp,receipt,'[data-work-open]');
  await approvals(a,c);
  assert.equal(a.game.id,gameId);assert.equal(await H.evalIn(a.game,'performance.timeOrigin'),origin,'host game never reloaded');
  check('control-bar invite brings '+c.label+' into the open room without reloading the host game');
}

const {connect}=require('./cdp.cjs');
// Real keys through one persistent CDP session per game: walk a loop of directions and drop a
// balloon (Space) every other turn.
async function play(app,ms){
  const s=app.cdpS??=await connect(app.game);const seq=['KeyD','KeyS','KeyA','KeyW'];const until=Date.now()+ms;let i=app.label.charCodeAt(0)%4;
  while(Date.now()<until){const k=seq[i++%4];await s.key(k);await H.sleep(500);await s.key(k,'keyUp');if(i%2===0)await s.press('Space');await H.sleep(150);}
}
// Stand still and keep dropping balloons: a quick way to end rounds (your own splash traps you).
async function giveUp(app,ms){const s=app.cdpS??=await connect(app.game);const until=Date.now()+ms;while(Date.now()<until){await s.press('Space');await H.sleep(700);}}
async function bombPlay(a,b,c,d){
  const all=[a,b,c,...(d?[d]:[])];
  for(const app of all)await wait(async()=>{const x=await state(app);return x.driver?.kind&&x.lobby?.length===all.length;},'driver + '+all.length+'-human lobby '+app.label,60000);
  for(const app of all)await screenshot(app.game,'12-lobby-'+app.label);
  // Production deliberately exchanges looks only in the lobby. Large current
  // packs must finish before pressing Ready; network tests keep the explicit
  // assertion that no new look transfers start during a match.
  const looksStarted=Date.now();
  // c/d intentionally share the same built-in pet. Count unique fixture looks,
  // then cross-check their actual receipt signatures after the settings snapshot.
  const lookRows=await Promise.all(all.map(async app=>({app,...await state(app)})));
  const lookKey=x=>JSON.stringify([x.driver.kind,x.driver.name]);
  const looks=new Set(lookRows.map(lookKey)),expected=new Map(lookRows.map(x=>[x.net.mySlot,[...looks].filter(k=>k!==lookKey(x)).length]));
  await wait(async()=>{const x=await state(a);return x.net.peers.length===all.length-1&&x.net.peers.every(p=>p.sent===expected.get(p.slot));},'all distinct lobby appearances have completed the real SDK transfer',600000);
  check('complete lobby appearance forwarding before ready',{elapsedMs:Date.now()-looksStarted,peers:(await state(a)).net.peers});
  // Host-only settings; guests cannot change them.
  assert.equal(await H.evalIn(b.game,'document.querySelector(\'#lobby-rounds [data-value="3"]\').disabled'),true);
  await activateButton(a.game,'#lobby-mode [data-value="ffa"]');await activateButton(a.game,'#lobby-rounds [data-value="3"]');
  const receiptRows=await wait(async()=>{const rows=await Promise.all(all.map(app=>state(app)));return rows.every(x=>x.net.ownSentSignature)?rows:null;},'actual signatures acknowledge every current lobby look',15000);
  const signatures=new Map();for(const x of receiptRows){const key=lookKey(x);if(signatures.has(key))assert.equal(x.net.ownSentSignature,signatures.get(key),'shared fixture pet has the identical actual appearance signature');else signatures.set(key,x.net.ownSentSignature);}
  assert.equal(new Set(signatures.values()).size,looks.size,'every distinct fixture look has a distinct received signature');
  check('actual SDK look receipts verify distinct and shared appearances',{signatures:[...signatures.values()]});
  await activateButton(a.game,'#ready');await activateButton(b.game,'#ready');await H.sleep(1500);
  assert.equal((await state(c)).phase,'lobby','two of three ready does not start');
  await activateButton(c.game,'#ready');if(d){await H.sleep(300);assert.equal((await state(d)).phase,'lobby','all four must ready');await activateButton(d.game,'#ready');}
  await wait(async()=>{for(const app of all)if(!['count','play'].includes((await state(app)).phase))return false;return true;},'all counting down',8000);
  const first=await state(a);assert.equal(first.players.length,4);assert.equal(first.players.filter(x=>x.kind==='bot').length,4-all.length);
  check('match requires all '+all.length+' humans ready; computers fill '+(4-all.length)+' seats');
  // Every screen draws every human with that human's own kind (2D / 3D).
  const kinds={},slots={};for(const app of all){const x=await state(app);kinds[app.label]=x.driver.kind;slots[app.label]=x.mySlot;}
  for(const app of all)await wait(async()=>{const p=(await world(app)).players;return all.every(o=>p.find(x=>x.slot===slots[o.label])?.kind===kinds[o.label]);},'every human drawn with its own kind on '+app.label,90000);
  check('each pet is drawn as its own 2D / 3D kind on every screen',{kinds,slots});
  await wait(async()=>(await state(a)).phase==='play','play',8000);
  // Play with real keys; meanwhile every screen must see balloons dropped by the others.
  const seen=Object.fromEntries(all.map(app=>[app.label,new Set()]));let polling=true;
  const poll=(async()=>{while(polling){for(const app of all){const x=await state(app).catch(()=>null);for(const bl of x?.balloons||[])if(bl.owner!==x.mySlot)seen[app.label].add(bl.owner);}await H.sleep(150);}})();
  await Promise.all(all.map(app=>play(app,9000)));polling=false;await poll;
  for(const app of all)await screenshot(app.game,'13-play-'+app.label);
  for(const app of all)for(const o of all)if(o!==app)assert(seen[app.label].has(slots[o.label]),app.label+' saw no balloon from '+o.label+': '+[...seen[app.label]]);
  check(all.length+' real keyboards walk and drop balloons; every screen sees the others\' balloons',Object.fromEntries(Object.entries(seen).map(([k,v])=>[k,[...v]])));
  // End the rounds quickly: everyone stands on their own balloons until the match is decided.
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){let done=true;for(const app of all)if((await state(app)).phase!=='results')done=false;if(done)break;await Promise.all(all.map(app=>giveUp(app,3000)));}
  await wait(async()=>{for(const app of all)if((await state(app)).phase!=='results')return false;return true;},'results everywhere',30000);
  await H.sleep(1500);
  const res=[];for(const app of all)res.push(await state(app));
  const r=res[0].result;assert(r&&r.wins);
  for(const x of res){assert.deepEqual(x.result,r,'the same scores and stats table on every host');assert.equal(x.hash,res[0].hash,'the same grid at the end');}
  check('identical results and identical final grid on all '+all.length+' hosts',{winner:r.winner,wins:r.wins,hash:res[0].hash});
  for(const app of all)await screenshot(app.game,'14-results-'+app.label);
  await assertNoErrors(all,'match');check('no error message on any host through lobby, match and results');
  report.net=res.map(x=>x.net&&{bySlot:x.net.bySlot,recent:x.net.recent?.slice(-8)});
  // Guest c leaves at the results; the host starts again with b and a computer in c's seat.
  const cSlot=slots.c;await activateButton(c.game,'#leave');
  await activateButton(a.game,'#again');
  await wait(async()=>{const x=await state(b);return ['count','play'].includes(x.phase);},'rematch reaches b',10000);
  await wait(async()=>(await state(a)).players.find(x=>x.slot===cSlot)?.kind==='bot','c taken over by a computer',20000);
  if(d)await wait(async()=>['count','play'].includes((await state(d)).phase),'rematch reaches the fourth guest',10000);
  const remaining=[a,b,...(d?[d]:[])];
  for(const app of remaining)await wait(async()=>(await world(app)).players.find(p=>p.slot===cSlot)?.kind==='toy','computer takeover uses a toy despite a shared human signature '+app.label,15000);
  for(const app of remaining){await wait(async()=>{const players=(await world(app)).players;return remaining.every(o=>{const p=players.find(p=>p.slot===slots[o.label]);return p?.kind===kinds[o.label];});},'remaining appearances survive shared-seat takeover '+app.label,15000);await screenshot(app.game,'15-rematch-'+app.label);}
  check('a guest leaving is taken over by a computer; the host starts a rematch');
  await closeWork(a);
  await wait(async()=>{const x=await state(b);return x.session===null||x.phase==='closed';},'host closing ends the room for b',20000);
  await screenshot(b.game,'15-host-closed');check('host closing the game ends the room for the remaining guest');
  if(d)await wait(async()=>{const x=await state(d);return x.session===null||x.phase==='closed';},'host close ends fourth guest',20000);for(const app of all)app.cdpS?.close();
}
(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  try{
    H.requireNode22();assert(fs.existsSync(source),'build first');report.gameSha256=hash(source);report.testSha256=hash(__filename);report.helperSha256=hash(path.join(HOST,'tests/helpers/game-relay-fixture.js'));
    if(mode==='lan'&&fs.existsSync(path.join(HOST,'demo/core/trial-access/index.js'))){mandatory=await require(path.join(HOST,'tests/helpers/mandatory-login-fixture')).createMandatoryLoginFixture();report.admission='real isolated production account service and UI login; unique phone per host';}
    runtime=F.freeze(H.REPO,root,false);report.source=runtime.source;
    if(mode!=='lan'){relay=await require(path.join(HOST,'tests/helpers/game-relay-fixture')).start({hostRoot:HOST,root,evidence});report.relaySource=relay.source;}
    const ports=await Promise.all(labels.map(()=>F.freePort()));for(let i=0;i<labels.length;i++)await boot(labels[i],ports[i],ports.filter((_,j)=>j!==i));const [a,b,c,d]=apps;
    if(!process.env.MOTION_AUDIT)for(const app of [a,b])await installAppearances(app);
    if(!process.env.MOTION_AUDIT){await applyMain(a,'rat-doll-male');await applyMain(b,'rat-doll-female');}
    await nearby(a,c);await sendGame(a,b);await approvals(a,b);await inviteFromControls(a,c);if(d){await nearby(a,d);await inviteFromControls(a,d);const controls=await H.findTarget(a.cdp,'/work-player.html');await wait(()=>H.evalIn(controls,'document.querySelector("[data-work-invite]")?.disabled && document.querySelector("[data-work-invite]").textContent.includes("4/4")'),'full room disables further invitation');check('four-player capacity is enforced by the real host invite control');}if(relay){const slot=(await state(b)).mySlot,origin=await H.evalIn(a.game,'performance.timeOrigin');assert((await relay.snapshot('b')).connections>0,'actual relay socket exists');await relay.outage('b',3000);await wait(async()=>['reconnecting','waiting'].includes((await state(b)).net.connection),'actual relay disconnect observed',6000);await wait(async()=>(await state(b)).net.connection==='connected'&&(await state(a)).lobby.some(p=>p.slot===slot),'same room recovers after socket outage',12000);assert.equal((await state(b)).mySlot,slot);assert.equal(await H.evalIn(a.game,'performance.timeOrigin'),origin);check('3s actual relay socket interruption reconnects without reloading or changing seat');}if(process.env.MOTION_AUDIT)await require('./motion-host.cjs').run({apps,H,wait,state,activateButton,screenshot,json,evidence,report,check,closeWork,game:'bomb'});else await bombPlay(a,b,c,d);
  }catch(error){
    report.failures.push(error.message);report.error=error.stack;console.error(error);
    for(const app of apps){const list=await targets(app).catch(()=>[]);json(path.join(evidence,app.label+'-targets.json'),list.map(t=>({type:t.type,url:t.url,title:t.title})));
      for(const c of list.filter(t=>t.url.includes('/work-player.html')))json(path.join(evidence,app.label+'-work-player.json'),await H.evalIn(c,'({text:document.body.innerText,state:window.__state||null})',3000).catch(e=>({error:e.message})));
      json(path.join(evidence,app.label+'-work-inspect.json'),await (async()=>{const chat=list.find(t=>t.url.includes('/chat.html'));return chat?await H.evalIn(chat,'chatAPI.e2eInspectHtmlWork?.()',3000).catch(e=>({error:e.message})):'no chat';})());}
    for(const app of apps)for(const page of await targets(app).catch(()=>[]))if(page.type==='page'&&page.url.startsWith('pet-work:')){
      json(path.join(evidence,app.label+'-failure.json'),await H.evalIn(page,'({text:document.body.innerText.slice(0,3000),bomb:window.__bomb?.state(),world:window.__bomb?.world()})',3000).catch(e=>({error:e.message})));
      await screenshot(page,app.label+'-failure').catch(()=>{});
    }
  }finally{
    for(const ws of sockets)ws.close();
    for(const app of apps)await stop(app).catch(e=>report.failures.push('cleanup: '+e.message));
    if(mandatory)await mandatory.close().catch(e=>report.failures.push('account fixture cleanup: '+e.message));
    for(const app of apps){app.cdpS?.close();for(const run of app.runs||[])try{const rows=fs.readFileSync(run.native,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);assert(rows.some(r=>r.event==='loaded'&&r.page==='index.html'));assert(rows.every(r=>!r.isVisible&&!r.isFocused&&r.backgroundThrottling===false));assert(run.exited);}catch(e){report.failures.push('native isolation '+app.label+': '+e.message);}}
    if(relay){try{relay.assertAlive();report.relayCleanup=await relay.stop();}catch(e){report.failures.push(e.message);}}
    if(runtime&&!isDeepStrictEqual(F.hashes(runtime.root),runtime.files))report.failures.push('frozen source changed');
    if(report.testSha256&&hash(__filename)!==report.testSha256)report.failures.push('test changed during run');if(report.helperSha256&&hash(path.join(HOST,'tests/helpers/game-relay-fixture.js'))!==report.helperSha256)report.failures.push('helper changed during run');
    if(report.gameSha256&&hash(source)!==report.gameSha256)report.failures.push('game changed during run');
    if(report.exceptions.length)report.failures.push('uncaught renderer exceptions');
    report.ok=!report.failures.length;json(path.join(evidence,'report.json'),report);
    console.log('REPORT',path.join(evidence,'report.json'),report.ok?'OK':'FAIL');process.exitCode=report.ok?0:1;
  }
})().then(()=>process.exit(process.exitCode||0));
