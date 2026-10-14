'use strict';
// Candidate: a delayed display of original samples. Never writes into simulation.
const Motion=require('../vendor/pet-kit/motion.js');
function create(){
 const tracks=new Map(),latest=new Map();
 const clock=()=>performance.now();
 function push(slot,time,value,key){
  if(!Number.isFinite(time))return;
  let track=tracks.get(slot);if(!track){track=Motion.create({delayMs:220,maxProjectionMs:0,interpolate:(a,b,f)=>({...b,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f}),discontinuous:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)>2.5});tracks.set(slot,track);}
  if(track.push({time,value,key},clock()))latest.set(slot,{time,value:{...value},key});
 }
 return {push,latest:slot=>latest.get(slot),clear(){tracks.clear();latest.clear();},remove(slot){tracks.delete(slot);latest.delete(slot);},
 world(w,active){if(!w||!active)return w;const t=clock();return {...w,players:w.players.map(p=>{if(p.owner!=='remote'||!p.alive)return p;const s=tracks.get(p.slot)?.sample(t);return s?{...p,x:s.x,y:s.y,face:s.face}:p;})};}};
}
module.exports={create};
