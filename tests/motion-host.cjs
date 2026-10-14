'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),CDP=require('./cdp.cjs');
function metrics(rows,slot,run){
 const f=rows.filter(p=>p.slot===slot&&p.run===run),d=[];
 for(let i=1;i<f.length;i++){const a=f[i-1],b=f[i],dt=(b.t-a.t)/1000;if(dt<.005||dt>.05||a.phase!=='play'||b.phase!=='play'||!a.moving||!b.moving||!a.alive||!b.alive)continue;d.push({dt,v:Math.hypot(b.x-a.x,b.y-a.y)/dt});}
 const speeds=d.map(p=>p.v).sort((a,b)=>a-b);return {frames:d.length,holdRatio:d.filter(p=>p.v<.01).length/(d.length||1),p95Speed:speeds[Math.floor(speeds.length*.95)]??null,maxSpeed:speeds.at(-1)??null};
}
exports.run=async({apps,H,wait,state,activateButton,screenshot,json,evidence,report,check,closeWork,game})=>{
 const sessions=[];report.baselineSha=process.env.MOTION_BASELINE_SHA;report.measurements=[];
 try{
  const first=apps[0];
  if(game==='tank')await activateButton(first.game,'#lobby-mode [data-value="versus"]');
  const slots={};for(const app of apps){slots[app.label]=(await state(app)).net.mySlot;app.motion=await CDP.connect(app.game);sessions.push(app.motion);app.motion.on(m=>{if(m.method==='Page.screencastFrame')void app.motion.send('Page.screencastFrameAck',{sessionId:m.params.sessionId});});await app.motion.send('Page.startScreencast',{format:'jpeg',quality:1,maxWidth:160,maxHeight:100,everyNthFrame:1});}
  for(const app of apps)await activateButton(app.game,'#ready');
  await wait(async()=>{for(const app of apps)if((await state(app)).phase!=='play')return false;return true;},'all players actually playing',15000);
  for(const app of apps)await app.motion.evaluate('document.activeElement?.blur();window.__motion=[];window.__motionRun="normal";window.__motionProbe=p=>{if(__motion.length<30000)__motion.push({...p,run:__motionRun,phase:(window.__bomb||window.__tank).state().phase});};true');
  for(const run of ['normal','batched']){
   for(const app of apps)await app.motion.evaluate(`window.__motionRun=${JSON.stringify(run)};true`);
   if(run==='batched')for(const app of apps.slice(1))await app.motion.evaluate('window.__delayedPolls=0;window.__motionPollDelay=()=>{__delayedPolls++;return new Promise(r=>setTimeout(r,180));};true');
   // Real alternating inputs exercise turns and walls, without moving game state.
   for(let i=0;i<20;i++){
    const code=['KeyD','KeyA','KeyS','KeyW'][i%4];
    await Promise.all(apps.map(app=>app.motion.key(code)));await H.sleep(350);await Promise.all(apps.map(app=>app.motion.key(code,'keyUp')));
   }
   for(const app of apps){assert.equal((await state(app)).phase,'play','no end-of-round contamination');await screenshot(app.game,'motion-'+run+'-'+app.label);}
  }
  for(const app of apps)await app.motion.evaluate('window.__motionRun="stopped";window.__motionPollDelay=null;true');
  await H.sleep(1100);
  const all=[];for(const app of apps){const rows=await app.motion.evaluate('__motion');json(path.join(evidence,'motion-'+app.label+'.json'),rows);all.push({app,rows});if(app!==first)assert(await app.motion.evaluate('__delayedPolls')>10,'batch fault executed');}
  for(const {app,rows} of all)for(const actor of apps)for(const run of ['normal','batched']){
   const result={viewer:app.label,actor:actor.label,own:app===actor,run,...metrics(rows,slots[actor.label],run)};report.measurements.push(result);
   assert(result.frames>25,'enough actual moving render frames '+JSON.stringify(result));
  }
  report.stop=[];
  for(const actor of apps){const slot=slots[actor.label],source=all.find(x=>x.app===actor).rows.filter(p=>p.slot===slot).at(-1);for(const {app,rows} of all){const p=rows.filter(p=>p.slot===slot).at(-1);const tail=rows.filter(p=>p.slot===slot&&p.run==='stopped'&&p.t>rows.at(-1).t-250);report.stop.push({actor:actor.label,viewer:app.label,phase:p.phase,alive:p.alive,errorCells:Math.hypot(p.x-source.x,p.y-source.y),driftCells:tail.length?Math.hypot(p.x-tail[0].x,p.y-tail[0].y):null});}}
  console.log('MOTION',JSON.stringify(report.measurements));console.log('STOP',JSON.stringify(report.stop));
  // Audit completion proves coverage, not good motion. Publish defects separately.
  report.findings=report.measurements.filter(m=>{const own=report.measurements.find(s=>s.own&&s.actor===m.actor&&s.run===m.run);return !m.own&&(m.holdRatio>own.holdRatio+.2||m.p95Speed>own.p95Speed*2);});
  check('real own/remote render trajectories recorded for normal, 180ms batches, turns and stops',{samples:report.measurements.length,concerns:report.findings.length});
  for(const app of apps){await app.motion.send('Page.stopScreencast');app.motion.close();app.motion=null;}
  await closeWork(first);await wait(async()=>{for(const app of apps.slice(1)){const s=await state(app);if(s.session!==null&&s.phase!=='closed')return false;}return true;},'host exit closes all guests',20000);
 }finally{for(const app of apps)if(app.motion){for(const code of ['KeyD','KeyA','KeyS','KeyW'])await app.motion.key(code,'keyUp').catch(()=>{});await app.motion.send('Page.stopScreencast').catch(()=>{});app.motion.close();}}
};
