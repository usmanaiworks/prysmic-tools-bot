require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { setupDatabase, User, Setting, Invoice } = require('./database');

const escapeHtml = (text) => {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const getEmoji = (product) => {
    if (product.emoji) return product.emoji;
    const name = (product.name || '').toLowerCase();
    if (name.includes('chatgpt') || name.includes('openai') || name.includes('gpt')) return '🤖';
    if (name.includes('netflix')) return '🍿';
    if (name.includes('canva')) return '🎨';
    if (name.includes('spotify')) return '🎵';
    if (name.includes('discord') || name.includes('nitro')) return '🎮';
    if (name.includes('youtube') || name.includes('yt ')) return '📺';
    if (name.includes('apple') || name.includes('mac')) return '🍎';
    if (name.includes('office') || name.includes('microsoft') || name.includes('windows')) return '💼';
    if (name.includes('prime') || name.includes('amazon')) return '📦';
    if (name.includes('crunchyroll') || name.includes('anime')) return '🦊';
    if (name.includes('vpn') || name.includes('proxy')) return '🛡️';
    if (name.includes('capcut') || name.includes('edit')) return '✂️';
    if (name.includes('adobe') || name.includes('creative')) return '🖌️';
    return '💎';
};

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token === 'your_telegram_bot_token_here') {
    console.error('TELEGRAM_BOT_TOKEN is missing or invalid.');
}

const API_BASE = 'https://ventetelegrambotrailway-production.up.railway.app';
const API_KEY = process.env.RESELLER_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;
const CRYPTO_BOT_TOKEN = process.env.CRYPTO_BOT_TOKEN;

const getAxiosConfig = () => ({
    headers: { 'X-Reseller-Key': API_KEY, 'Content-Type': 'application/json' }
});

// --- IN-MEMORY CACHE FOR LIGHTNING FAST RESPONSES ---
let productCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getProducts(force = false) {
    if (!force && productCache && (Date.now() - lastCacheTime < CACHE_TTL)) {
        return productCache;
    }
    try {
        const response = await axios.get(`${API_BASE}/api/reseller/products`, getAxiosConfig());
        if (response.data.success) {
            productCache = response.data.products;
            lastCacheTime = Date.now();
            return productCache;
        }
    } catch (e) {
        console.error("Failed to fetch products:", e.message);
    }
    return productCache || [];
}
// ---------------------------------------------------

// Connect to database on boot (Vercel caches this across warm invocations)
setupDatabase().catch(console.error);

const bot = new TelegramBot(token);

// --- VERCEL WEBHOOK ROUTES ---
app.post('/api/bot', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.get('/api/setWebhook', async (req, res) => {
    const url = req.query.url; // pass the vercel url e.g., ?url=https://mybot.vercel.app
    if (!url) return res.send('Please pass ?url=https://your-vercel-project.vercel.app');
    
    try {
        await bot.setWebHook(`${url}/api/bot`);
        res.send(`✅ Webhook successfully set to ${url}/api/bot`);
    } catch (e) {
        res.send(`❌ Error setting webhook: ${e.message}`);
    }
});

// --- ADMIN API ROUTES ---
const adminAuth = (req, res, next) => {
    const pass = req.headers['x-admin-pass'];
    if (pass !== (process.env.ADMIN_PASSWORD || 'admin123')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    next();
};

app.post('/api/admin/login', (req, res) => {
    if (req.body.password === (process.env.ADMIN_PASSWORD || 'admin123')) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
    const users = await User.find();
    const totalBalance = users.reduce((acc, u) => acc + u.balance, 0);
    const markupSetting = await Setting.findOne({ key: 'markup' });
    const markup = markupSetting ? parseFloat(markupSetting.value) : 1.2;
    res.json({ success: true, totalUsers: users.length, totalBalance, markup });
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
    const users = await User.find().sort({ balance: -1 });
    res.json({ success: true, users });
});

app.post('/api/admin/balance', adminAuth, async (req, res) => {
    const { userId, amount } = req.body;
    await User.updateOne({ id: userId }, { $inc: { balance: amount } });
    res.json({ success: true });
    try {
        bot.sendMessage(userId, `💰 <b>Your account has been updated by admin. Balance change: $${amount.toFixed(2)}</b>`, { parse_mode: 'HTML' });
    } catch (e) {}
});

app.post('/api/admin/markup', adminAuth, async (req, res) => {
    const { markup } = req.body;
    await Setting.updateOne({ key: 'markup' }, { value: markup.toString() }, { upsert: true });
    res.json({ success: true });
});

app.get('/api/admin/products', adminAuth, async (req, res) => {
    const products = await getProducts();
    const markupSetting = await Setting.findOne({ key: 'markup' });
    const markup = markupSetting ? parseFloat(markupSetting.value) : 1.15;
    res.json({ success: true, products, markup });
});

app.post('/api/admin/clearcache', adminAuth, async (req, res) => {
    await getProducts(true); // Force sync
    res.json({ success: true });
});
// -----------------------------

bot.setMyCommands([
        { command: '/start', description: '🚀 Main Menu' },
        { command: '/products', description: '🛒 Products & Catalog' },
        { command: '/wallet', description: '💳 Wallet & Top-up' },
        { command: '/profile', description: '👤 Account Profile' }
    ]);

    // DB Helper
    const getUser = async (from) => {
        let user = await User.findOne({ id: from.id });
        if (!user) {
            user = await User.create({
                id: from.id,
                username: from.username || '',
                first_name: from.first_name || '',
                balance: 0.00
            });
        } else {
            // Update names if changed
            if (user.username !== from.username || user.first_name !== from.first_name) {
                user.username = from.username || '';
                user.first_name = from.first_name || '';
                await user.save();
            }
        }
        return user;
    };

    const getMarkup = async () => {
        const row = await Setting.findOne({ key: 'markup' });
        return row ? parseFloat(row.value) : 1.20;
    };

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const welcomeMessage = `<b>Welcome to the Premium Store!</b> 💎\n\nPlease choose an option below or use the menu:`;
        
        bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🛒 View Products', callback_data: 'cmd_products' }],
                    [{ text: '💳 My Wallet', callback_data: 'cmd_wallet' }]
                ]
            }
        });
    });

    bot.onText(/\/(me|balance|wallet|profile)/, async (msg) => {
        const chatId = msg.chat.id;
        await sendWalletInfo(chatId, msg.from);
    });

    async function sendWalletInfo(chatId, from) {
        try {
            const user = await getUser(from);
            let message = `👤 <b>Account Info</b>\nName: ${escapeHtml(user.first_name)} (@${escapeHtml(user.username)})\nID: <code>${user.id}</code>\n\n💰 <b>Your Balance:</b> $${user.balance.toFixed(2)}\n\n<i>To add funds via CryptoBot, type <code>/deposit 5</code> (to deposit $5).</i>`;
            
            // If admin, also show reseller balance
            if (ADMIN_ID && from.id === ADMIN_ID) {
                try {
                    const resellerResp = await axios.get(`${API_BASE}/api/reseller/me`, getAxiosConfig());
                    if (resellerResp.data.success) {
                        message += `\n\n👑 <b>Admin Wholesale Info</b>\nGlobal Wholesale Balance: $${resellerResp.data.wallet_balance}`;
                    }
                } catch(e) {}
            }

            bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (error) {
            console.error('Error fetching wallet:', error.message);
            bot.sendMessage(chatId, '❌ Failed to retrieve account information.');
        }
    }

    bot.onText(/\/products/, async (msg) => {
        await sendProductsMenu(msg.chat.id);
    });

    async function sendProductsMenu(chatId, editMessageId = null) {
        try {
            // Show typing indicator for instant feedback
            bot.sendChatAction(chatId, 'typing').catch(()=>{});

            let products = await getProducts();
            
            // Hide out of stock products
            products = products.filter(p => p.stock > 0);

            if (!products || products.length === 0) {
                const msg = '😞 Currently, no products are available.';
                if (editMessageId) {
                    bot.editMessageText(msg, { chat_id: chatId, message_id: editMessageId, parse_mode: 'HTML' });
                } else {
                    bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
                }
                return;
            }

            const markup = await getMarkup();

            const inlineKeyboard = [];
            products.forEach(p => {
                let priceDisplay = 'N/A';
                if (p.price_usd !== undefined) {
                    const finalPrice = p.price_usd * markup;
                    priceDisplay = `$${finalPrice.toFixed(2)}`;
                }
                
                const emoji = getEmoji(p);
                const stockStatus = p.stock === 0 ? 'Out of stock' : (p.stock === null ? '∞' : p.stock);
                const btnText = `${emoji} ${p.name} | ${priceDisplay} | ${stockStatus}`;
                inlineKeyboard.push([{ text: btnText, callback_data: `view_${p.id}` }]);
            });
            
            const messageText = '🛒 <b>Choose a product:</b>';
            const replyMarkup = { inline_keyboard: inlineKeyboard };

            if (editMessageId) {
                bot.editMessageText(messageText, { chat_id: chatId, message_id: editMessageId, parse_mode: 'HTML', reply_markup: replyMarkup });
            } else {
                bot.sendMessage(chatId, messageText, { parse_mode: 'HTML', reply_markup: replyMarkup });
            }
        } catch (error) {
            console.error('Error fetching products:', error.message);
            bot.sendMessage(chatId, '❌ Failed to fetch products. Please try again later.');
        }
    }

    // Admin Commands
    bot.onText(/\/addbalance (\d+) ([\d\.]+)/, async (msg, match) => {
        if (!ADMIN_ID || msg.from.id !== ADMIN_ID) return;
        const targetId = parseInt(match[1]);
        const amount = parseFloat(match[2]);
        await User.updateOne({ id: targetId }, { $inc: { balance: amount } });
        bot.sendMessage(msg.chat.id, `✅ Added $${amount.toFixed(2)} to user ${targetId}.`);
        try {
            bot.sendMessage(targetId, `💰 <b>Your account has been credited with $${amount.toFixed(2)}!</b>`, { parse_mode: 'HTML' });
        } catch (e) {}
    });

    bot.onText(/\/removebalance (\d+) ([\d\.]+)/, async (msg, match) => {
        if (!ADMIN_ID || msg.from.id !== ADMIN_ID) return;
        const targetId = parseInt(match[1]);
        const amount = parseFloat(match[2]);
        await User.updateOne({ id: targetId }, { $inc: { balance: -amount } });
        bot.sendMessage(msg.chat.id, `✅ Removed $${amount.toFixed(2)} from user ${targetId}.`);
    });

    bot.onText(/\/setmarkup ([\d\.]+)/, async (msg, match) => {
        if (!ADMIN_ID || msg.from.id !== ADMIN_ID) return;
        const newMarkup = parseFloat(match[1]);
        await Setting.updateOne({ key: 'markup' }, { value: newMarkup.toString() }, { upsert: true });
        bot.sendMessage(msg.chat.id, `✅ Global markup set to ${newMarkup}x (e.g. 1.20 = 20% markup).`);
    });

    // Automated CryptoBot Topups
    bot.onText(/\/deposit(?:\s+([\d\.]+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        
        if (!match[1]) {
            return bot.sendMessage(chatId, 'ℹ️ <b>How to deposit:</b>\nPlease specify the amount in USDT. Example:\n<code>/deposit 5</code> (to deposit $5)', { parse_mode: 'HTML' });
        }
        
        const amount = parseFloat(match[1]);
        if (!CRYPTO_BOT_TOKEN) {
            return bot.sendMessage(chatId, '❌ Crypto payments are not configured by the admin yet.');
        }
        if (amount < 0.5) {
            return bot.sendMessage(chatId, '❌ Minimum deposit is $0.50');
        }

        try {
            const invoicePayload = {
                asset: 'USDT',
                amount: amount.toString(),
                payload: `deposit_${msg.from.id}_${Date.now()}`,
                allow_comments: false,
                allow_anonymous: false
            };
            
            const response = await axios.post('https://pay.crypt.bot/api/createInvoice', invoicePayload, {
                headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN }
            });
            
            if (response.data.ok) {
                const invoice = response.data.result;
                await Invoice.create({
                    invoice_id: invoice.invoice_id.toString(),
                    amount: amount,
                    user_id: msg.from.id,
                    status: 'pending'
                });
                
                bot.sendMessage(chatId, `🧾 **Invoice created for $${amount.toFixed(2)} USDT!**\n\nClick the button below to securely pay via @CryptoBot. Once you've paid, click 'Check Status'.`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💳 Pay with CryptoBot', url: invoice.pay_url }],
                            [{ text: '🔄 Check Status', callback_data: `checkinvoice_${invoice.invoice_id}` }]
                        ]
                    }
                });
            } else {
                bot.sendMessage(chatId, '❌ Failed to create invoice.');
            }
        } catch (error) {
            console.error('CryptoBot Error:', error.message);
            bot.sendMessage(chatId, '❌ Failed to connect to payment gateway.');
        }
    });

    bot.onText(/\/buy(?:\s+(\d+))?(?:\s+(\d+))?/, async (msg, match) => {
        if (!match[1]) {
            bot.sendMessage(msg.chat.id, 'ℹ️ <b>How to buy:</b>\nPlease specify the Product ID. Example:\n<code>/buy 12</code>', { parse_mode: 'HTML' });
            return;
        }
        await processPurchase(msg.chat.id, parseInt(match[1]), match[2] ? parseInt(match[2]) : 1, msg.from);
    });

    async function processPurchase(chatId, productId, quantity, fromUser, messageToEdit = null) {
        const user = await getUser(fromUser);
        const markup = await getMarkup();

        let loadingMsg = `Processing purchase for Product ID: ${productId} (Qty: ${quantity})...`;
        if (messageToEdit) {
            bot.editMessageText(loadingMsg, { chat_id: chatId, message_id: messageToEdit });
        } else {
            bot.sendMessage(chatId, loadingMsg);
        }

        try {
            // Check price from products cache
            bot.sendChatAction(chatId, 'typing').catch(()=>{});
            const products = await getProducts();
            const product = products.find(p => p.id === productId);
            if (!product) {
                const err = `❌ Product not found.`;
                if (messageToEdit) bot.editMessageText(err, { chat_id: chatId, message_id: messageToEdit });
                else bot.sendMessage(chatId, err);
                return;
            }

            const costUsd = (product.price_usd * markup) * quantity;
            if (user.balance < costUsd) {
                const err = `❌ <b>Insufficient Balance!</b>\nYour balance: $${user.balance.toFixed(2)}\nCost: $${costUsd.toFixed(2)}\n\nPlease top up your wallet.`;
                if (messageToEdit) bot.editMessageText(err, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML' });
                else bot.sendMessage(chatId, err, { parse_mode: 'HTML' });
                return;
            }

            // Deduct locally first
            await User.updateOne({ id: user.id }, { $inc: { balance: -costUsd } });

            let response;
            try {
                const payload = {
                    product_id: productId,
                    quantity: quantity,
                    activation_identifier: fromUser.username ? `@${fromUser.username}` : fromUser.id.toString(),
                    customer_reference: `tg_user_${fromUser.id}`,
                    idempotency_key: `order-${fromUser.id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
                };
                response = await axios.post(`${API_BASE}/api/reseller/orders`, payload, getAxiosConfig());
            } catch (apiError) {
                // REFUND THE USER IF THE API CALL FAILED
                await User.updateOne({ id: user.id }, { $inc: { balance: costUsd } });
                throw apiError;
            }
            
            if (response.data.success) {
                const order = response.data.order;
                const pName = escapeHtml(order.product_name);
                let successMsg = `✅ <b>Purchase successful!</b>\n\n`;
                successMsg += `<b>Order ID:</b> ${order.id}\n`;
                successMsg += `<b>Product:</b> ${pName}\n`;
                successMsg += `<b>Status:</b> ${order.status}\n`;
                successMsg += `<b>Amount Paid:</b> $${costUsd.toFixed(2)}\n`;
                
                const updatedUser = await getUser(fromUser);
                successMsg += `<b>Remaining Balance:</b> $${updatedUser.balance.toFixed(2)}\n`;

                if (order.items && order.items.length > 0) {
                     successMsg += `\n<b>Delivery Details:</b>\n`;
                     order.items.forEach(item => {
                         if (item.account_data) successMsg += `<code>${item.account_data}</code>\n`;
                     });
                }

                if (messageToEdit) bot.editMessageText(successMsg, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML' });
                else bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML' });
            }
        } catch (error) {
            console.error('Error buying product:', error.message);
            
            let errorMsg = '❌ Failed to process the purchase. Network Error.';
            if (error.response) {
                const status = error.response.status;
                const errorData = error.response.data;
                errorMsg = `❌ Purchase failed: ${errorData.message || 'Server error'}`;
            } else if (error.message) {
                errorMsg = `❌ Purchase failed: ${error.message}`;
            }
            
            if (messageToEdit) bot.editMessageText(errorMsg, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML' });
            else bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' });
        }
    }

    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const data = query.data;

        try {
            if (data === 'cmd_products') {
                bot.answerCallbackQuery(query.id);
                await sendProductsMenu(chatId, messageId);
            } 
            else if (data === 'cmd_wallet') {
                bot.answerCallbackQuery(query.id);
                await sendWalletInfo(chatId, query.from);
            }
            else if (data.startsWith('view_')) {
                const productId = parseInt(data.split('_')[1]);
                bot.answerCallbackQuery(query.id);
                
                const products = await getProducts();
                const product = products.find(p => p.id === productId);
                const markup = await getMarkup();

                if (!product) {
                    bot.sendMessage(chatId, '❌ Product not found.');
                    return;
                }
                
                const finalPrice = product.price_usd * markup;
                const priceDisplay = product.price_usd !== undefined ? `$${finalPrice.toFixed(2)}` : 'N/A';
                
                const emoji = getEmoji(product);
                const name = escapeHtml(product.name);
                const desc = escapeHtml(product.description);
                const stockDisplay = product.stock === 0 ? '❌ Out of stock' : (product.stock === null ? '✅ Unlimited' : `📦 ${product.stock} available`);
                
                const message = `${emoji} <b>${name}</b>\n━━━━━━━━━━━━━━━━━━\n💰 <b>Price:</b> ${priceDisplay}\n🏷️ <b>Type:</b> ${product.delivery_type}\n📊 <b>Stock:</b> ${stockDisplay}\n\n📝 <b>Description:</b>\n<i>${desc}</i>\n━━━━━━━━━━━━━━━━━━`;
                
                bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `💲 Buy Now (${priceDisplay})`, callback_data: `buyconfirm_${product.id}` }],
                            [{ text: '🔙 Back to Products', callback_data: 'cmd_products' }]
                        ]
                    }
                });
            }
            else if (data.startsWith('buyconfirm_')) {
                const productId = parseInt(data.split('_')[1]);
                bot.answerCallbackQuery(query.id);
                await processPurchase(chatId, productId, 1, query.from, messageId);
            }
            else if (data.startsWith('checkinvoice_')) {
                const invoiceId = data.split('_')[1];
                bot.answerCallbackQuery(query.id);
                
                if (!CRYPTO_BOT_TOKEN) return bot.sendMessage(chatId, '❌ Payment gateway not configured.');
                
                const dbInvoice = await Invoice.findOne({ invoice_id: invoiceId });
                if (!dbInvoice) return bot.sendMessage(chatId, '❌ Invoice not found in our records.');
                if (dbInvoice.status === 'paid') return bot.sendMessage(chatId, '✅ This invoice has already been paid and credited!');
                
                try {
                    const response = await axios.get('https://pay.crypt.bot/api/getInvoices', {
                        params: { invoice_ids: invoiceId },
                        headers: { 'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN }
                    });
                    
                    if (response.data.ok && response.data.result.items.length > 0) {
                        const cryptInvoice = response.data.result.items[0];
                        if (cryptInvoice.status === 'paid') {
                            await Invoice.updateOne({ invoice_id: invoiceId }, { status: 'paid' });
                            await User.updateOne({ id: dbInvoice.user_id }, { $inc: { balance: dbInvoice.amount } });
                            
                            bot.editMessageText(`✅ **Payment Successful!**\n\n$${dbInvoice.amount.toFixed(2)} has been added to your wallet!`, {
                                chat_id: chatId,
                                message_id: messageId,
                                parse_mode: 'Markdown'
                            });
                        } else {
                            bot.sendMessage(chatId, `⏳ Invoice status is still **${cryptInvoice.status}**. Please complete the payment and check again.`, { parse_mode: 'Markdown' });
                        }
                    } else {
                         bot.sendMessage(chatId, '❌ Invoice could not be verified with CryptoBot.');
                    }
                } catch (err) {
                    bot.sendMessage(chatId, '❌ Error checking invoice status.');
                }
            }
        } catch (e) {
            console.error('Error handling callback query:', e.message);
            bot.answerCallbackQuery(query.id, { text: 'An error occurred.', show_alert: true });
        }
    });

    bot.on('error', (error) => console.error('General Error:', error.code, error.message));
    process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

module.exports = app;
