const test=require('node:test');
const assert=require('node:assert/strict');
const User=require('../src/models/User');
const PushSubscription=require('../src/models/PushSubscription');
const webpush=require('web-push');
const {sendToUsers}=require('../src/services/pushGoalService');

test('strong signal opt-out excludes only that alert; ordinary goal push still reaches the subscriber',async()=>{
  const findUsers=User.find,findSubs=PushSubscription.find,send=webpush.sendNotification;
  const publicKey=process.env.VAPID_PUBLIC_KEY,privateKey=process.env.VAPID_PRIVATE_KEY;
  const sent=[];
  try{
    process.env.VAPID_PUBLIC_KEY='test';process.env.VAPID_PRIVATE_KEY='test';
    User.find=()=>({select:()=>({lean:async()=>[{_id:'enabled-user'}]})});
    PushSubscription.find=query=>({lean:async()=>query.userId.$in.map(id=>({endpoint:id,keys:{p256dh:'a',auth:'b'}}))});
    webpush.sendNotification=async subscription=>{sent.push(subscription.endpoint)};
    await sendToUsers(['enabled-user','disabled-user'],{type:'strong-goal-signal'});
    assert.deepEqual(sent,['enabled-user']);
    await sendToUsers(['enabled-user','disabled-user'],{type:'goal'});
    assert.deepEqual(sent,['enabled-user','enabled-user','disabled-user']);
  }finally{
    User.find=findUsers;PushSubscription.find=findSubs;webpush.sendNotification=send;
    if(publicKey===undefined)delete process.env.VAPID_PUBLIC_KEY;else process.env.VAPID_PUBLIC_KEY=publicKey;
    if(privateKey===undefined)delete process.env.VAPID_PRIVATE_KEY;else process.env.VAPID_PRIVATE_KEY=privateKey;
  }
});
