'use strict';
// A match (SPEC §7, §8): rounds until one side has enough round wins, or too many rounds.
// Sides: 's<slot>' in free-for-all, 't<team>' in team mode.
const {MATCH,SPAWNS}=require('./config.cjs');
const teamOfSlot=slot=>SPAWNS[slot][0]<7?0:1; // left corners orange, right corners blue
function create({mode='ffa',rounds=3}={}){
  if(!MATCH.rounds.includes(rounds))rounds=3;
  return {mode,rounds,firstTo:MATCH.firstTo[rounds],maxRounds:MATCH.maxRounds[rounds],round:0,wins:{},history:[],winner:undefined};
}
// Records a finished round; returns the match result once decided ({winner: side | null}).
function record(m,roundResult){
  m.round++;m.history.push(roundResult.winner);
  if(roundResult.winner)m.wins[roundResult.winner]=(m.wins[roundResult.winner]||0)+1;
  const top=Object.entries(m.wins).find(([,n])=>n>=m.firstTo);
  if(top)m.winner=top[0];else if(m.round>=m.maxRounds)m.winner=null;
  return m.winner===undefined?null:{winner:m.winner};
}
const over=m=>m.winner!==undefined;
module.exports={create,record,over,teamOfSlot};
