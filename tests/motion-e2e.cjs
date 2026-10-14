 'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const game="bomb",source=process.env.MOTION_BASELINE_HTML||path.join(__dirname,'../dist/桌宠水球大作战.html');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),game+'-motion-')),out=path.join(dir,path.basename(source));
fs.writeFileSync(out,require('./motion-artifact.cjs').instrument(fs.readFileSync(source,'utf8'),game));
const result=spawnSync(process.execPath,[path.join(__dirname,'host-e2e.cjs'),...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,MOTION_AUDIT:'1',MOTION_HTML:out,MOTION_BASELINE_SHA:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')}});
process.exit(result.status??1);
