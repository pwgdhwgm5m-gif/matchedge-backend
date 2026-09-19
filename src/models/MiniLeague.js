const mongoose=require('mongoose');
const miniLeagueSchema=new mongoose.Schema({
 name:{type:String,required:true,trim:true,maxlength:40},
 code:{type:String,required:true,unique:true,index:true},
 ownerId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},
 members:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],
 createdAt:{type:Date,default:Date.now}
});
module.exports=mongoose.model('MiniLeague',miniLeagueSchema);