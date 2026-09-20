const mongoose=require('mongoose');
const PowerRatingSchema=new mongoose.Schema({
 league:{type:String,index:true},teamId:{type:String,index:true},teamName:String,
 elo:{type:Number,default:1500},attack:{type:Number,default:1},defense:{type:Number,default:1},
 games:{type:Number,default:0},lastFixtureId:String,lastMatchAt:Date,season:String
},{timestamps:true});
PowerRatingSchema.index({league:1,teamId:1},{unique:true});
module.exports=mongoose.models.PowerRating||mongoose.model('PowerRating',PowerRatingSchema);
