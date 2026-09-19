const mongoose=require('mongoose');
const directMessageSchema=new mongoose.Schema({
 sender:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 recipient:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
 senderName:{type:String,required:true,maxlength:30},
 recipientName:{type:String,required:true,maxlength:30},
 text:{type:String,required:true,maxlength:280},
 readAt:{type:Date,default:null,index:true},
 status:{type:String,enum:['visible','under_review','removed'],default:'visible',index:true},
 reportedBy:[{type:mongoose.Schema.Types.ObjectId,ref:'User'}],
 reportReasons:[{reporter:{type:mongoose.Schema.Types.ObjectId,ref:'User'},reason:{type:String,enum:['abuse','spam','hate','sexual','personal_info','other']},createdAt:{type:Date,default:Date.now}}]
},{timestamps:true});
directMessageSchema.index({sender:1,recipient:1,createdAt:-1});
directMessageSchema.index({recipient:1,readAt:1,createdAt:-1});
module.exports=mongoose.model('DirectMessage',directMessageSchema);
