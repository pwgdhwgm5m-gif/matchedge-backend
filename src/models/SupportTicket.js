const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: {
    type: String,
    enum: ['chat_safety', 'account', 'technical', 'other'],
    default: 'chat_safety',
  },
  message: { type: String, required: true, maxlength: 1000 },
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
