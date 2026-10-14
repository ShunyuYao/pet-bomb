'use strict';
// Instrument the exact released HTML, not a separately rebuilt simulation.
// Read-only Three object transforms; the sole fault is delay before real SDK poll.
const assert=require('node:assert/strict'),vm=require('node:vm');
exports.instrument=(html,game)=>{
 let positions=0,polls=0,closes=0;
 const re=game==='bomb'?/([\w$]+)\.group\.position\.set\(([\w$]+)\(([\w$]+)\.x\),\3\.trapped\?\.25\+Math\.sin\(([\w$]+)\*2\.4\)\*\.06:0,([\w$]+)\(\3\.y\)\)/g:/([\w$]+)\.tank\.group\.position\.set\(([\w$]+)\(([\w$]+)\.x\),0,([\w$]+)\(\3\.y\)\)/g;
 html=html.replace(re,(m,obj,wx,p)=>{positions++;const root=obj+(game==='tank'?'.tank':'')+'.group';return m+`,globalThis.__motionProbe?.({t:performance.now(),slot:${p}.slot,x:${root}.position.x,y:${root}.position.z,moving:!!${p}.moving,alive:!!${p}.alive,owner:${p}.owner})`;});
 html=html.replace(/await ([\w$]+)\.poll\(/g,(m,api)=>{polls++;return `(await globalThis.__motionPollDelay?.(),await ${api}.poll(`;});
 html=html.replace(/waitMs:1e3\}\);/g,m=>{closes++;return 'waitMs:1e3}));';});
 assert.equal(positions,1,'one actual human-root transform');assert.equal(polls,1);assert.equal(closes,1);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert(js);new vm.Script(js);return html;
};
