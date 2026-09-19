const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  fixtureId: { type: String, required: true, index: true },
  matchLabel: { type: String, required: true, maxlength: 140 },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authorName: { type: String, required: true, maxlength: 30 },
  text: { type: String, required: true, maxlength: 280 },
  kind: { type:String, enum:['message','pick'], default:'message' },
  pick: { key:String, market:String, label:String, probability:Number },
  reactions: {
    edge: [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }],
    agree: [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }],
    fire: [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }]
  },
  status: {
    type: String,
    enum: ['visible', 'under_review', 'removed'],
    default: 'visible',
    index: true,
  },
  reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reportReasons: [{
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, enum: ['abuse', 'spam', 'hate', 'sexual', 'personal_info', 'other'] },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

chatMessageSchema.index({ fixtureId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
