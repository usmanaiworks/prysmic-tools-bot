const mongoose = require('mongoose');

// Schemas
const userSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true }, // Telegram ID
    username: { type: String, default: '' },
    first_name: { type: String, default: '' },
    balance: { type: Number, default: 0.00 }
});

const settingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true }
});

const invoiceSchema = new mongoose.Schema({
    invoice_id: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    user_id: { type: Number, required: true },
    status: { type: String, default: 'pending' }
});

// Models
const User = mongoose.model('User', userSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Invoice = mongoose.model('Invoice', invoiceSchema);

async function setupDatabase() {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
        console.warn('⚠️ MONGODB_URI is missing in .env! The bot will not be able to connect to the database.');
        return { User, Setting, Invoice };
    }

    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Initialize default markup percentage to 20% if not exists
        const markup = await Setting.findOne({ key: 'markup' });
        if (!markup) {
            await Setting.create({ key: 'markup', value: '1.20' }); // 20% markup
        }
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }

    return { User, Setting, Invoice };
}

module.exports = { setupDatabase, User, Setting, Invoice };
