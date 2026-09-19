const mongoose=require('mongoose');
const arenaChatSchema=new mongoose.Schema({
 author:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 authorName:{type:String,required:true,maxlength:30},
 text:{type:String,required:true,maxlength:280},
 status:{type:String,enum:['visible','under_review','removed'],default:'visible',index:true},
 reportedBy:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],
 reportReasons:[{reporter:{type:mongoose.Schema.Types.ObjectId,ref:'User'},reason:{type:String,enum:['abuse','spam','hate','sexual','personal_info','other']},createdAt:{type:Date,default:Date.now}}]
},{timestamps:true});
arenaChatSchema.index({createdAt:-1});
module.exports=mongoose.model('ArenaChatMessage',arenaChatSchema);
