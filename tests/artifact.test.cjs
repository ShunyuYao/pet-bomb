'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),protocol=require('../game/net.js').PROTOCOL;
test('built internet and LAN files declare the real protocol and pinned pet-kit, with exact receipts',()=>{
 assert.deepEqual(protocol,{id:'pet-bomb',version:2});
 for(const lane of ['auto','lan']){
  const info=JSON.parse(fs.readFileSync(path.join(root,'dist',lane==='auto'?'build.json':'build-lan.json')));
  const html=fs.readFileSync(path.join(root,info.file));
  const sdk=JSON.parse(html.toString().match(/<script type="application\/json" id="pet-sdk">([^<]+)<\/script>/)[1]);
  assert.equal(sdk.version,2);assert.equal(sdk.interaction.transport,lane);assert.equal(sdk.interaction.players,4);
  assert.deepEqual(sdk.interaction.protocol,protocol);assert.deepEqual(info.protocol,protocol);assert.equal(info.transport,lane);
  assert.equal(info.petKit,'0.2.1');assert.equal(info.petKit,require('../vendor/pet-kit/verify.cjs').check(root));
  assert.equal(info.bytes,html.length);assert.equal(info.sha256,crypto.createHash('sha256').update(html).digest('hex'));
  assert(!/__STYLE__|__SCRIPT__/.test(html.toString()));
 }
});
