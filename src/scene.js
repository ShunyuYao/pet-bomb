// The 3D view (SPEC §10): a tiled courtyard seen from a fixed angle, furniture, crates, books,
// items, balloons, splashes, players (3D doll / 2D standee / toy) with bubbles.
// Reads the simulation, never writes it. Grid cell (i, j) sits at world (i − 7, 0, j − 6).
import * as THREE from '../vendor/lib/three.module.js';
import Config from '../game/config.cjs';
import Sim from '../game/sim.cjs';
import {buildAvatar} from './avatars.js';

const {W,H,CELL,ITEMS,BALLOON,TRAP}=Config;
const OX=(W-1)/2,OZ=(H-1)/2,PET_HEIGHT=1.35;
const wx=gx=>gx-OX,wz=gy=>gy-OZ;
const SLOT=Config.SLOT_COLORS.map(c=>new THREE.Color(c)),TEAM=Config.TEAMS.map(t=>new THREE.Color(t.color));

function canvasTexture(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
const std=(opts)=>new THREE.MeshStandardMaterial({roughness:.75,...opts});

export function createWorld(canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#24363d');
  const camera=new THREE.PerspectiveCamera(30,1,0.5,200);
  scene.add(new THREE.HemisphereLight('#f4fffb','#6d8a84',1.5));
  const sun=new THREE.DirectionalLight('#ffffff',1.6);sun.position.set(-6,16,8);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-10,right:10,top:9,bottom:-9,near:1,far:40});scene.add(sun);

  // Floor: checker tiles with grout, one plane.
  const floorTex=canvasTexture(W*64,H*64,(g)=>{for(let y=0;y<H;y++)for(let x=0;x<W;x++){g.fillStyle=(x+y)%2?'#cfeee6':'#bfe4da';g.fillRect(x*64,y*64,64,64);g.strokeStyle='rgba(60,110,100,.18)';g.lineWidth=2;g.strokeRect(x*64+1,y*64+1,62,62);}});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,H),std({map:floorTex,roughness:.9}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(W+30,H+30),std({color:'#2d4750'}));ground.rotation.x=-Math.PI/2;ground.position.y=-0.02;scene.add(ground);

  // Static and changing blocks, one instanced mesh per kind.
  const crateTex=canvasTexture(128,128,(g)=>{g.fillStyle='#d9a86c';g.fillRect(0,0,128,128);g.fillStyle='#f0cf92';g.fillRect(52,0,24,128);g.strokeStyle='rgba(120,80,30,.45)';g.lineWidth=4;g.strokeRect(4,4,120,120);g.beginPath();g.moveTo(8,64);g.lineTo(46,64);g.moveTo(82,64);g.lineTo(120,64);g.stroke();});
  const kinds={
    wall:{geo:new THREE.BoxGeometry(1,0.45,1),mat:std({color:'#557684'}),y:0.225},
    furniture:{geo:new THREE.BoxGeometry(0.9,0.56,0.9),mat:std({color:'#8a5a3c'}),y:0.28},
    furnitureTop:{geo:new THREE.BoxGeometry(0.98,0.08,0.98),mat:std({color:'#b07d53'}),y:0.6},
    crate:{geo:new THREE.BoxGeometry(0.84,0.56,0.84),mat:std({map:crateTex}),y:0.28},
    book:{geo:new THREE.BoxGeometry(0.9,0.42,0.7),mat:std({color:'#ffffff'}),y:0.21},
  };
  const inst={};
  for(const [k,v] of Object.entries(kinds)){const m=new THREE.InstancedMesh(v.geo,v.mat,W*H);m.count=0;m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;scene.add(m);inst[k]=m;}
  const BOOK_COLORS=['#e45c5c','#4f8fdd','#f2b84b','#58b87a','#9c6ade'].map(c=>new THREE.Color(c));
  const mtx=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scl=new THREE.Vector3(1,1,1),col=new THREE.Color();
  const bookFall=new Map(); // cell → time it started falling (seconds, view clock)
  let clock=0,lastWorld=null;

  function drawBlocks(w){
    if(w!==lastWorld){lastWorld=w;bookFall.clear();}
    const n={wall:0,furniture:0,furnitureTop:0,crate:0,book:0};
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const c=w.cells[y*W+x];let k=null;
      if(c===CELL.wall)k='wall';else if(c===CELL.furniture)k='furniture';else if(c===CELL.crate)k='crate';else if(c===CELL.book)k='book';
      if(!k)continue;
      let yy=kinds[k].y;
      if(k==='book'){const i=y*W+x;if(!bookFall.has(i))bookFall.set(i,clock);const t=Math.min(1,(clock-bookFall.get(i))/0.35);yy+=(1-t*t)*5;quat.setFromAxisAngle(new THREE.Vector3(0,1,0),(i%5)*0.2);}else quat.identity();
      pos.set(wx(x),yy,wz(y));mtx.compose(pos,quat,scl);inst[k].setMatrixAt(n[k],mtx);
      if(k==='book')inst.book.setColorAt(n.book,BOOK_COLORS[(x*7+y*3)%BOOK_COLORS.length]);
      n[k]++;
      if(k==='furniture'){pos.y=kinds.furnitureTop.y;quat.identity();mtx.compose(pos,quat,scl);inst.furnitureTop.setMatrixAt(n.furnitureTop++,mtx);}
    }
    for(const [k,m] of Object.entries(inst)){m.count=n[k];m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
  }

  // Items: a small group per lying item.
  const itemMeshes=new Map(); // cell → {group, item}
  function itemGroup(name){
    const g=new THREE.Group();
    const glow=new THREE.Mesh(new THREE.CircleGeometry(0.34,24),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.55,depthWrite:false}));glow.rotation.x=-Math.PI/2;glow.position.y=0.015;g.add(glow);
    const icon=new THREE.Group();icon.position.y=0.38;g.add(icon);g.userData.icon=icon;
    const add=(geo,color,p=[0,0,0],r=[0,0,0])=>{const m=new THREE.Mesh(geo,std({color,roughness:.35,emissive:color,emissiveIntensity:.15}));m.position.set(...p);m.rotation.set(...r);m.castShadow=true;icon.add(m);return m;};
    if(name==='bomb'){add(new THREE.SphereGeometry(0.2,20,14),'#2bb3d6');add(new THREE.BoxGeometry(0.2,0.05,0.05),'#ffffff',[0,0,0.19]);add(new THREE.BoxGeometry(0.05,0.2,0.05),'#ffffff',[0,0,0.19]);}
    if(name==='fire'){add(new THREE.SphereGeometry(0.16,20,14),'#23a6d5',[0,-0.05,0]);add(new THREE.ConeGeometry(0.155,0.26,20),'#23a6d5',[0,0.15,0]);}
    if(name==='shoe'){add(new THREE.CapsuleGeometry(0.1,0.22,6,12),'#ff6f91',[0,-0.05,0],[Math.PI/2,0,0]);add(new THREE.BoxGeometry(0.2,0.05,0.12),'#ffffff',[0,0.05,-0.02]);}
    if(name==='kick'){add(new THREE.BoxGeometry(0.16,0.28,0.16),'#ff9f1c',[0,0.04,0]);add(new THREE.BoxGeometry(0.16,0.1,0.3),'#ff9f1c',[0,-0.1,0.07]);}
    if(name==='needle'){add(new THREE.CylinderGeometry(0.025,0.01,0.46,10),'#c9d3de',[0,0,0],[0,0,0.5]);add(new THREE.SphereGeometry(0.07,14,10),'#ff5f8f',[-0.11,0.2,0]);}
    scene.add(g);return g;
  }
  function drawItems(w){
    const seen=new Set();
    for(let i=0;i<w.lying.length;i++){const v=w.lying[i];if(v<0)continue;seen.add(i);let e=itemMeshes.get(i);
      if(!e||e.item!==v){if(e)scene.remove(e.group);e={group:itemGroup(ITEMS[v]),item:v};itemMeshes.set(i,e);e.group.position.set(wx(i%W),0,wz(Math.floor(i/W)));}
      e.group.userData.icon.rotation.y=clock*1.6+i;e.group.userData.icon.position.y=0.38+Math.sin(clock*3+i)*0.05;}
    for(const [i,e] of itemMeshes)if(!seen.has(i)){scene.remove(e.group);itemMeshes.delete(i);}
  }

  // Balloons: a group per balloon id.
  const balloonMeshes=new Map();
  function balloonGroup(color){
    const g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.SphereGeometry(0.34,24,18),std({color,roughness:.25,emissive:color,emissiveIntensity:.1}));body.position.y=0.36;body.castShadow=true;g.add(body);
    const shine=new THREE.Mesh(new THREE.SphereGeometry(0.09,12,8),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.7}));shine.position.set(-0.12,0.52,0.18);g.add(shine);
    const knot=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.1,10),std({color}));knot.position.y=0.72;g.add(knot);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(0.3,20),new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:.2,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=0.012;g.add(shadow);
    g.userData.body=body;scene.add(g);return g;
  }
  function drawBalloons(w,ownerColor){
    const seen=new Set();
    for(const b of w.balloons){seen.add(b.id);let g=balloonMeshes.get(b.id);if(!g){g=balloonGroup(ownerColor(b.owner));balloonMeshes.set(b.id,g);}
      const off=b.slide?b.off:0,x=b.x+(b.slide?b.slide.dx*off:0),y=b.y+(b.slide?b.slide.dy*off:0);
      g.position.set(wx(x),0,wz(y));
      const left=Math.max(0,(b.explodeAt-w.t)/BALLOON.fuseMs),beat=1+Math.sin(clock*(8+20*(1-left)))*0.05*(1+2*(1-left));
      g.userData.body.scale.set(beat,1/beat,beat);}
    for(const [id,g] of balloonMeshes)if(!seen.has(id)){scene.remove(g);balloonMeshes.delete(id);}
  }

  // Splashes: a pool of flat water tiles.
  const splashPool=[],splashGeo=new THREE.BoxGeometry(0.94,0.16,0.94);
  function drawSplashes(w){
    let n=0;
    for(const s of w.splashes){
      if(w.t>s.until)continue;const life=Math.max(0,Math.min(1,(w.t-s.t0)/BALLOON.splashMs));
      for(const i of s.cells){
        let m=splashPool[n];if(!m){m=new THREE.Mesh(splashGeo,new THREE.MeshStandardMaterial({color:'#44c7e6',transparent:true,opacity:.8,roughness:.1,emissive:'#1f8fb0',emissiveIntensity:.25,depthWrite:false}));scene.add(m);splashPool.push(m);}
        m.visible=true;m.position.set(wx(i%W),0.12+Math.sin(life*Math.PI)*0.12,wz(Math.floor(i/W)));const k=0.6+0.4*Math.sin(Math.min(1,life*3)*Math.PI/2);m.scale.set(k,1+Math.sin(life*Math.PI)*1.5,k);m.material.opacity=0.85*(1-life*0.6);n++;
      }
    }
    for(let i=n;i<splashPool.length;i++)splashPool[i].visible=false;
    return n;
  }

  // Players.
  const players=new Map(),building=new Map();
  function nameTag(text,color){
    const c=document.createElement('canvas');c.width=256;c.height=64;const g=c.getContext('2d');
    g.font='600 28px "PingFang SC","Microsoft YaHei",sans-serif';const w=Math.min(240,g.measureText(text).width+28);
    g.fillStyle='#'+color.getHexString();g.globalAlpha=.92;g.beginPath();g.roundRect((256-w)/2,10,w,44,22);g.fill();g.globalAlpha=1;
    g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';g.fillText(text,128,33);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));s.scale.set(1.6,0.4,1);s.renderOrder=10;return s;
  }
  async function setPlayer(slot,{signature,asset,fallback,name,color}){
    const c=new THREE.Color(color);const cur=players.get(slot);
    if(cur&&cur.signature===signature&&cur.name===name&&cur.color===color)return;
    const token={};building.set(slot,token);
    const avatar=await buildAvatar(asset,fallback,{height:PET_HEIGHT});
    if(building.get(slot)!==token){avatar.dispose?.();return;}
    const old=players.get(slot);if(old){scene.remove(old.group);old.avatar.dispose?.();}
    const group=new THREE.Group();group.add(avatar.object);avatar.object.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.34,0.43,32),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.9,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=0.02;group.add(ring);
    const tag=nameTag(name,c);tag.position.y=PET_HEIGHT*(asset?.kind==='doll3d'?1.35:1.1)+0.35;group.add(tag);
    const bubble=new THREE.Mesh(new THREE.SphereGeometry(0.62,32,20),new THREE.MeshStandardMaterial({color:'#bfeaff',transparent:true,opacity:.32,roughness:.05,metalness:.1,emissive:'#7fd3ff',emissiveIntensity:.2,depthWrite:false}));bubble.position.y=0.55;bubble.visible=false;group.add(bubble);
    const timer=new THREE.Mesh(new THREE.RingGeometry(0.13,0.2,32,1,Math.PI/2,Math.PI*2),new THREE.MeshBasicMaterial({color:'#e24a4a',depthTest:false,transparent:true}));timer.renderOrder=11;timer.visible=false;group.add(timer);
    scene.add(group);players.set(slot,{avatar,group,ring,tag,bubble,timer,timerFrac:1,signature,name,color,runPhase:0,flash:0,kind:avatar.kind,fade:1});
  }
  function removePlayer(slot){const p=players.get(slot);if(p){scene.remove(p.group);p.avatar.dispose?.();players.delete(slot);}}
  function drawPlayers(w,dt){
    for(const a of w.players){
      const p=players.get(a.slot);if(!p)continue;
      const speed=a.moving&&a.alive?Sim.speedOf(a):0;p.runPhase+=dt*speed*2.6;
      p.fade+=((a.alive?1:0)-p.fade)*Math.min(1,dt*6);
      p.group.visible=p.fade>0.02;p.group.position.set(wx(a.x),a.trapped?0.25+Math.sin(clock*2.4)*0.06:0,wz(a.y));
      const yaw=Math.atan2(a.face[1],a.face[0]);
      p.avatar.update(dt,{yaw,run:a.trapped?0:Math.min(1,speed/4),runPhase:p.runPhase,cheer:w.result&&a.alive?1:0,visible:true,alpha:p.fade,flash:0});
      p.ring.visible=a.alive&&!a.trapped;
      p.bubble.visible=!!a.trapped&&a.alive;
      p.timer.visible=p.bubble.visible;
      if(p.timer.visible){
        const frac=Math.max(0,Math.min(1,(a.trapped.until-w.t)/TRAP.ms));
        if(Math.abs(frac-p.timerFrac)>0.02){p.timerFrac=frac;p.timer.geometry.dispose();p.timer.geometry=new THREE.RingGeometry(0.13,0.2,32,1,Math.PI/2,Math.PI*2*frac);}
        p.timer.position.set(0,p.tag.position.y+0.42,0);p.timer.quaternion.copy(camera.quaternion);
      }
    }
  }

  function resize(){const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();fit();}
  // Frame the board as large as it goes: the playable cells (inside the wall ring) must fit
  // between the side cards and under the score bar; the outer wall may run under the cards.
  // Found by projecting the board corners, so it holds for any window size.
  const PITCH=58*Math.PI/180,_v=new THREE.Vector3();
  function fits(dist,lookZ,box){
    camera.position.set(0,dist*Math.sin(PITCH),lookZ+dist*Math.cos(PITCH));camera.lookAt(0,0,lookZ);camera.updateMatrixWorld();
    let minX=1,maxX=-1,minY=1,maxY=-1;
    for(const [x,z,y] of [[-OX+0.5,-OZ+0.5,PET_HEIGHT],[OX-0.5,-OZ+0.5,PET_HEIGHT],[-OX+0.5,OZ-0.5,0],[OX-0.5,OZ-0.5,0],[-OX+0.5,OZ-0.5,0.3],[OX-0.5,OZ-0.5,0.3]]){
      _v.set(x,y,z).project(camera);minX=Math.min(minX,_v.x);maxX=Math.max(maxX,_v.x);minY=Math.min(minY,_v.y);maxY=Math.max(maxY,_v.y);}
    return {ok:minX>=box.l&&maxX<=box.r&&minY>=box.b&&maxY<=box.t,minY,maxY};
  }
  function fit(){
    const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;
    const side=w>700?Math.min(0.2,150/w*2):0.04; // side cards take ~140 px each on a wide window
    const box={l:-1+side,r:1-side,b:-1+36/h*2,t:1-96/h*2};
    const want=(box.b+box.t)/2;let lookZ=0.3,hi=80;
    for(let pass=0;pass<4;pass++){
      let lo=4;hi=80;for(let k=0;k<30;k++){const m=(lo+hi)/2;if(fits(m,lookZ,box).ok)hi=m;else lo=m;}
      // Centre the board vertically inside the box (the projected middle moves monotonically
      // with the look-at point), then fit the distance again.
      const mid=z=>{const f=fits(hi,z,box);return (f.minY+f.maxY)/2;};
      let a=-OZ,c=OZ;const up=mid(c)>mid(a);
      for(let k=0;k<30;k++){const m=(a+c)/2;if((mid(m)>want)===up)c=m;else a=m;}
      lookZ=(a+c)/2;
    }
    let lo=4;hi=80;for(let k=0;k<30;k++){const m=(lo+hi)/2;if(fits(m,lookZ,box).ok)hi=m;else lo=m;}
    fits(hi,lookZ,box);
  }
  addEventListener('resize',resize);resize();

  let lastSplashCells=0;
  function render(dt,{world:w,colorOf}){
    clock+=dt;
    if(w){drawBlocks(w);drawItems(w);drawBalloons(w,s=>colorOf(s));lastSplashCells=drawSplashes(w);drawPlayers(w,dt);}
    renderer.render(scene,camera);
  }
  // Grid cell → client px (for tests driven by real input).
  const tmp=new THREE.Vector3();
  function project(gx,gy,y=0.4){tmp.set(wx(gx),y,wz(gy)).project(camera);const r=canvas.getBoundingClientRect();return {x:r.left+(tmp.x+1)/2*r.width,y:r.top+(1-tmp.y)/2*r.height};}
  function info(){return {players:[...players.entries()].map(([slot,p])=>({slot,kind:p.kind,bubble:p.bubble.visible,visible:p.group.visible})),
    balloons:balloonMeshes.size,items:itemMeshes.size,splashCells:lastSplashCells,crates:inst.crate.count,books:inst.book.count,calls:renderer.info.render.calls};}
  return {render,setPlayer,removePlayer,project,info,renderer,camera};
}
