import mongoose from 'mongoose';

const toolSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    price: { type: String, required: true },
    targetUrl: { type: String }, // For proxy tools
    parameters: { type: Object },
    type: { type: String, enum: ['proxy', 'code'], default: 'proxy' },
    code: { type: String }, // For code tools (stored as string)
    walletAddress: { type: String },
    trusted: { type: Boolean, default: false }, // Trusted tools can access system env vars
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

export const Tool = mongoose.model('Tool', toolSchema);
