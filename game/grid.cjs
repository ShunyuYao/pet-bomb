'use strict';
// The map (SPEC §1): 15 × 13 cells, border walls, furniture on even/even cells, crates on about
// 60 % of the rest with items hidden in about 35 % of them. Everything follows the round seed,
// so every machine builds the same map from the same seed.
const {W,H,SPAWNS,CELL,CRATE_SHARE,ITEM_SHARE,ITEMS,ITEM_WEIGHTS}=require('./config.cjs');

function rng(seed){let a=(seed>>>0)||0x9e3779b9;return ()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const idx=(x,y)=>y*W+x;
const inside=(x,y)=>x>=0&&y>=0&&x<W&&y<H;

// Cells that must stay free: each spawn corner and its two neighbours along the border.
function safeCells(){
  const s=new Set();
  for(const [x,y] of SPAWNS){s.add(idx(x,y));s.add(idx(x+(x===1?1:-1),y));s.add(idx(x,y+(y===1?1:-1)));}
  return s;
}

function build(seed,{items='advanced'}={}){
  const r=rng(seed),cells=new Uint8Array(W*H),hidden=new Int8Array(W*H).fill(-1),safe=safeCells();
  const weights=ITEM_WEIGHTS[items]||ITEM_WEIGHTS.advanced,total=Object.values(weights).reduce((a,b)=>a+b,0);
  const pick=()=>{let v=r()*total;for(const [k,w] of Object.entries(weights)){if((v-=w)<0)return ITEMS.indexOf(k);}return 0;};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=idx(x,y);
    if(x===0||y===0||x===W-1||y===H-1)cells[i]=CELL.wall;
    else if(x%2===0&&y%2===0)cells[i]=CELL.furniture;
    else if(!safe.has(i)&&r()<CRATE_SHARE){cells[i]=CELL.crate;if(r()<ITEM_SHARE)hidden[i]=pick();}
  }
  return {cells,hidden};
}

// Sudden death (SPEC §7): the two outer rings, clockwise from the top-left, skipping furniture.
function bookOrder(){
  const out=[];
  for(let ring=1;ring<=2;ring++){
    const x0=ring,y0=ring,x1=W-1-ring,y1=H-1-ring,path=[];
    for(let x=x0;x<=x1;x++)path.push([x,y0]);
    for(let y=y0+1;y<=y1;y++)path.push([x1,y]);
    for(let x=x1-1;x>=x0;x--)path.push([x,y1]);
    for(let y=y1-1;y>y0;y--)path.push([x0,y]);
    for(const [x,y] of path)if(!(x%2===0&&y%2===0))out.push([x,y]);
  }
  return out;
}

// A cheap FNV hash of the cells + lying items, for "every screen ends with the host's grid".
function hash(cells,items){let h=0x811c9dc5;const mix=v=>{h^=v;h=Math.imul(h,0x01000193)>>>0;};for(let i=0;i<cells.length;i++){mix(cells[i]);mix(items[i]+1);}return h.toString(16);}

module.exports={rng,idx,inside,build,bookOrder,safeCells,hash};
