'use strict';
// Numbers from docs/SPEC.zh-CN.md. Times are integer milliseconds; positions are in cells,
// with the centre of cell (i, j) at (i, j).
module.exports={
  W:15,H:13,
  // Spawn corners by slot. Team mode: the two left corners are orange (0), the right ones blue (1).
  SPAWNS:[[1,1],[13,11],[13,1],[1,11]],
  CELL:{floor:0,wall:1,furniture:2,crate:3,book:4},
  CRATE_SHARE:0.6,ITEM_SHARE:0.35,
  ITEMS:['bomb','fire','shoe','kick','needle'],
  ITEM_WEIGHTS:{standard:{bomb:40,fire:40,shoe:20},advanced:{bomb:30,fire:30,shoe:20,kick:10,needle:10}},
  PLAYER:{speed:4,shoe:0.6,maxSpeed:7,bubbleSpeed:1,bombs:1,maxBombs:8,fire:2,maxFire:8,maxNeedles:1,assist:0.4,touch:0.8},
  BALLOON:{fuseMs:2500,splashMs:500,kickSpeed:8},
  TRAP:{ms:4000,freeInvulnMs:1000},
  ROUND:{countdownMs:3000,playMs:120000,suddenAtMs:90000,judgeMs:600},
  MATCH:{rounds:[3,5],firstTo:{3:2,5:3},maxRounds:{3:5,5:7}},
  MODES:['ffa','team'],
  TEAMS:[{name:'橘队',color:'#f47a12'},{name:'蓝队',color:'#2a5bd7'}],
  SLOT_COLORS:['#f47a12','#2a5bd7','#1fb86a','#e2489a'],
};
