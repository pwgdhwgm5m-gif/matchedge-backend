const mongoose = require('mongoose');

const selectionSchema = new mongoose.Schema({
  key: { type: String, required: true },
  market: { type: String, required: true },
  label: { type: String, required: true },
  probability: { type: Number, default: null },
  riskAcknowledged: { type: Boolean, default: false },
  result: { type: String, enum: ['pending', 'won', 'lost', 'void'], default: 'pending' },
}, { _id: false });

const legSchema = new mongoose.Schema({
  fixtureId:{type:String,required:true}, canonicalFixtureKey:{type:String,default:null}, homeTeam:{type:String,required:true}, awayTeam:{type:String,required:true},
  league:{type:String,default:''}, kickoff:{type:Date,default:null}, matchDate:{type:String,default:null},
  selection:{type:selectionSchema,required:true}, canonicalProvider:{type:String,enum:['sportmonks','bsd','sportsdb',null],default:null},
  providerIds:{sportsdb:String,sportmonks:String,bsd:String,footballData:String}, finalScore:{home:Number,away:Number,halftimeHome:Number,halftimeAway:Number}, resultSource:{type:String,default:null}, resultCheckedAt:{type:Date,default:null}
},{_id:false});

const couponSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fixtureId: { type: String, default: null, index: true },
  homeTeam: { type: String, default: '' },
  awayTeam: { type: String, default: '' },
  league: { type: String, default: '' },
  kickoff: { type: Date, default: null },
  matchDate: { type: String, default: null },
  selections: { type: [selectionSchema], default: [] },
  legs: { type:[legSchema], default:[], validate:value=>value.length<=8 },
  status: { type: String, enum: ['pending', 'won', 'lost', 'void'], default: 'pending' },
  stakeCoins: { type: Number, default: 10, min: 0 },
  payoutMultiplier: { type: Number, default: 1 },
  potentialPayout: { type: Number, default: 0, min: 0 },
  rewardedAt: { type: Date, default: null },
  resultSource: { type: String, default: null },
  resultCheckedAt: { type: Date, default: null },
  finalScore: { home: Number, away: Number, halftimeHome: Number, halftimeAway: Number },
  settledAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Coupon', couponSchema);
