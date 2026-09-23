require('dotenv').config();
const mongoose=require('mongoose');
const Prediction=require('../src/models/PredictionSnapshot');
const CommunityPick=require('../src/models/CommunityPick');

async function dropIfPresent(collection,name){
  const indexes=await collection.indexes();
  if(indexes.some(index=>index.name===name))await collection.dropIndex(name);
}

async function run(){
  if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);

  const predictions=await Prediction.find({canonicalFixtureKey:null,canonicalProvider:{$in:['sportmonks','bsd','sportsdb']}})
    .select('_id canonicalProvider providerIds').lean();
  for(const row of predictions){
    const id=String(row.providerIds?.[row.canonicalProvider]||'');
    if(id)await Prediction.updateOne({_id:row._id,canonicalFixtureKey:null},{$set:{canonicalFixtureKey:`${row.canonicalProvider}:${id}`}});
  }

  const picks=await CommunityPick.find({canonicalFixtureKey:null,canonicalProvider:{$in:['sportmonks','bsd','sportsdb']}})
    .select('_id canonicalProvider providerIds').lean();
  for(const row of picks){
    const id=String(row.providerIds?.[row.canonicalProvider]||'');
    if(id)await CommunityPick.updateOne({_id:row._id,canonicalFixtureKey:null},{$set:{canonicalFixtureKey:`${row.canonicalProvider}:${id}`}});
  }

  // MongoDB sparse unique indexes still include an explicitly stored null.
  // Remove unresolved null fields so legacy rows are excluded by the partial
  // unique indexes while remaining available for safe legacy settlement.
  await Prediction.updateMany({canonicalFixtureKey:null},{$unset:{canonicalFixtureKey:''}});
  await CommunityPick.updateMany({canonicalFixtureKey:null},{$unset:{canonicalFixtureKey:''}});

  await dropIfPresent(Prediction.collection,'fixtureId_1_modelVersion_1');
  await dropIfPresent(CommunityPick.collection,'userId_1_fixtureId_1_key_1');
  await Prediction.syncIndexes();
  await CommunityPick.syncIndexes();
  console.log(JSON.stringify({ok:true,predictionsBackfilled:predictions.length,picksBackfilled:picks.length}));
  await mongoose.disconnect();
}

run().catch(async error=>{
  console.error(error.message);
  try{await mongoose.disconnect()}catch(_){}
  process.exit(1);
});