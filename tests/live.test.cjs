const {test}=require('node:test'),assert=require('node:assert/strict'),create=require('../dist/live.js');
test('live PO subscription filters by workspace and user, batches events and cleans up on logout',async()=>{
 const handlers=[],statuses=[];let changes=0,removed=false;
 const channel={on(kind,filter,callback){handlers.push({kind,filter,callback});return this},subscribe(callback){this.status=callback;return this}};
 const live=create({client:{channel:()=>channel,removeChannel:c=>{assert.equal(c,channel);removed=true}},workspace:'W',user:'U',onChange:()=>changes++,onStatus:s=>statuses.push(s)});
 assert.equal(handlers.length,3);assert(handlers.every(x=>x.filter.event!=='DELETE'));assert.equal(handlers[0].filter.filter,'workspace_id=eq.W');assert.equal(handlers[2].filter.filter,'user_id=eq.U');
 channel.status('SUBSCRIBED');handlers[0].callback();handlers[1].callback();await new Promise(r=>setTimeout(r,240));assert.equal(changes,1);assert.deepEqual(statuses,['SUBSCRIBED']);
 handlers[2].callback();live.stop();await new Promise(r=>setTimeout(r,240));assert(removed);assert.equal(changes,1);
});