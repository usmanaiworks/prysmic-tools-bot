require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { setupDatabase, User, Setting, Invoice, ProductOverride } = require('./database');

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
    const n = (product.name || '').toLowerCase();
    
    // Check brand keywords for premium emojis (matching storebat aesthetic)
    if (n.includes('gemini')) return '✨';
    if (n.includes('chatgpt') || n.includes('openai') || n.includes('gpt')) return '🤖';
    if (n.includes('claude') || n.includes('anthropic')) return '🧠';
    if (n.includes('api') || n.includes('token') || n.includes('codex')) return '⚡';
    if (n.includes('apple') || n.includes('mac')) return '🍎';
    if (n.includes('windows') || n.includes('microsoft')) return '🪟';
    if (n.includes('office') || n.includes('365')) return '💼';
    if (n.includes('canva')) return '🎨';
    if (n.includes('capcut') || n.includes('edit')) return '✂️';
    if (n.includes('spotify')) return '🎵';
    if (n.includes('netflix') || n.includes('hbo') || n.includes('prime') || n.includes('video') || n.includes('peacock') || n.includes('supercut')) return '🍿';
    if (n.includes('discord') || n.includes('nitro')) return '👾';
    if (n.includes('youtube') || n.includes('yt ')) return '📺';
    if (n.includes('miro') || n.includes('magic patterns')) return '🧩';
    if (n.includes('warp') || n.includes('replit') || n.includes('cursor')) return '💻';
    if (n.includes('railway')) return '🚂';
    if (n.includes('quillbot') || n.includes('grok')) return '🤖';
    if (n.includes('brain.fm')) return '🎧';
    if (n.includes('descript')) return '🎙️';
    if (n.includes('factory')) return '🏭';
    if (n.includes('manus')) return '🪄';
    if (n.includes('framer') || n.includes('figma')) return '🖼️';
    if (n.includes('linear') || n.includes('trading view') || n.includes('tradingview')) return '📈';
    if (n.includes('elevenlabs') || n.includes('wispr')) return '🗣️';
    if (n.includes('n8n')) return '🔄';
    if (n.includes('mobbin')) return '📱';
    if (n.includes('lovable')) return '💖';
    if (n.includes('coursera') || n.includes('edu') || n.includes('student')) return '🎓';
    if (n.includes('gamma')) return '📊';
    if (n.includes('gmail') || n.includes('email')) return '📧';
    if (n.includes('notion')) return '📝';
    if (n.includes('vpn') || n.includes('proxy') || n.includes('nord') || n.includes('surfshark')) return '🛡️';
    if (n.includes('key')) return '🔑';
    if (n.includes('adobe') || n.includes('creative')) return '🖌️';
    if (n.includes('duolingo')) return '🦉';
    if (n.includes('autodesk')) return '📐';
    
    // If no brand matches, extract from <tg-emoji> if present, else fallback
    if (product.emoji) {
        // If it's a raw tg-emoji tag, extract the fallback emoji character inside it
        const match = product.emoji.match(/>([^<]+)<\/tg-emoji>/);
        if (match && match[1]) return match[1];
        if (!product.emoji.includes('<tg-emoji')) return product.emoji;
    }
    return '💎'; // Premium generic fallback
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
            let apiProducts = response.data.products;
            
            // Merge with MongoDB Overrides (Hidden & Custom Pricing)
            const overrides = await ProductOverride.find({});
            const overrideMap = {};
            overrides.forEach(o => { overrideMap[o.product_id] = o; });

            const markupSetting = await Setting.findOne({ key: 'markup' });
            const globalMarkup = markupSetting ? parseFloat(markupSetting.value) : 1.15;

            // Apply overrides
            productCache = apiProducts.map(p => {
                const ovr = overrideMap[p.id];
                p.hidden = ovr && ovr.hidden === true;
                
                // Calculate final retail price here so we don't need to recalculate everywhere
                if (ovr && ovr.custom_price !== null && ovr.custom_price !== undefined) {
                    p.retail_price = ovr.custom_price;
                    p.is_custom_price = true;
                } else if (p.price_usd !== undefined) {
                    p.retail_price = p.price_usd * globalMarkup;
                    p.is_custom_price = false;
                } else {
                    p.retail_price = 0;
                }
                return p;
            });

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
app.post('/api/bot', async (req, res) => {
    try {
        await setupDatabase(); // Make sure DB is connected before processing
        bot.processUpdate(req.body);
    } catch(e) {
        console.error(e);
    }
    
    // VERY IMPORTANT FOR VERCEL: 
    // Vercel freezes the serverless function the exact millisecond res.sendStatus() is called.
    // Because bot.processUpdate runs asynchronously in the background, if we send 200 immediately, 
    // Vercel will freeze the bot mid-thought, causing messages to get stuck for 10+ seconds.
    // We delay the HTTP response by 2.5 seconds to give the bot time to finish sending messages to Telegram!
    setTimeout(() => {
        res.sendStatus(200);
    }, 2500);
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

app.post('/api/admin/product-override', adminAuth, async (req, res) => {
    const { product_id, hidden, custom_price } = req.body;
    await ProductOverride.updateOne(
        { product_id: parseInt(product_id) },
        { hidden: hidden, custom_price: custom_price === '' ? null : parseFloat(custom_price) },
        { upsert: true }
    );
    await getProducts(true); // Force refresh cache to apply overrides
    res.json({ success: true });
});

app.post('/api/admin/clearcache', adminAuth, async (req, res) => {
    await getProducts(true); // Force sync
    res.json({ success: true });
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
    const { markup, trc20_wallet, binance_uid } = req.body;
    if (markup !== undefined) {
        await Setting.updateOne({ key: 'markup' }, { value: markup.toString() }, { upsert: true });
    }
    if (trc20_wallet !== undefined) {
        await Setting.updateOne({ key: 'trc20_wallet' }, { value: trc20_wallet.trim() }, { upsert: true });
    }
    if (binance_uid !== undefined) {
        await Setting.updateOne({ key: 'binance_uid' }, { value: binance_uid.trim() }, { upsert: true });
    }
    res.json({ success: true });
});

app.get('/api/admin/settings', adminAuth, async (req, res) => {
    const trc20Setting = await Setting.findOne({ key: 'trc20_wallet' });
    const binanceSetting = await Setting.findOne({ key: 'binance_uid' });
    res.json({ 
        success: true, 
        trc20_wallet: trc20Setting ? trc20Setting.value : '',
        binance_uid: binanceSetting ? binanceSetting.value : ''
    });
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
            
            // Hide out of stock and manually hidden products
            products = products.filter(p => p.stock > 0 && !p.hidden);

            if (!products || products.length === 0) {
                const msg = '😞 Currently, no products are available.';
                if (editMessageId) {
                    bot.editMessageText(msg, { chat_id: chatId, message_id: editMessageId, parse_mode: 'HTML' });
                } else {
                    bot.sendMessage(chatId, msg, { parse_mode: 'HTML' });
                }
                return;
            }

            const inlineKeyboard = [];
            products.forEach(p => {
                let priceDisplay = 'N/A';
                if (p.retail_price !== undefined) {
                    priceDisplay = `$${p.retail_price.toFixed(2)}`;
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
                const shortage = costUsd - user.balance;
                
                const trc20Setting = await Setting.findOne({ key: 'trc20_wallet' });
                const trc20Wallet = trc20Setting ? trc20Setting.value : null;

                const binanceSetting = await Setting.findOne({ key: 'binance_uid' });
                const binanceUid = binanceSetting ? binanceSetting.value : null;

                if (!CRYPTO_BOT_TOKEN && !trc20Wallet && !binanceUid) {
                    const err = `❌ <b>Insufficient Balance</b>\n\nYour Balance: $${user.balance.toFixed(2)}\nProduct Cost: $${costUsd.toFixed(2)}\n\nPlease ask the admin to enable payment methods.`;
                    if (messageToEdit) return bot.editMessageText(err, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML' });
                    return bot.sendMessage(chatId, err, { parse_mode: 'HTML' });
                }

                try {
                    // Generate a CryptoBot invoice for exactly the shortage (or the full amount)
                    const invoicePayload = {
                        asset: 'USDT',
                        amount: shortage.toFixed(2).toString(),
                        payload: `buy_${productId}_${fromUser.id}_${Date.now()}`,
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
                            amount: shortage,
                            user_id: fromUser.id,
                            target_product_id: productId // Direct Checkout Flag
                        });
                        
                        const payMsg = `⚠️ <b>Insufficient Balance</b>\n\nYour Balance: $${user.balance.toFixed(2)}\nProduct Cost: $${costUsd.toFixed(2)}\n\n💳 <b>Direct Checkout:</b>\nPay exactly <b>$${shortage.toFixed(2)} USDT</b> via the button below to instantly receive your product!`;
                        
                        const keyboard = {
                            inline_keyboard: []
                        };
                        
                        if (CRYPTO_BOT_TOKEN) {
                            keyboard.inline_keyboard.push([{ text: '💸 Pay via CryptoBot', url: invoice.pay_url }]);
                            keyboard.inline_keyboard.push([{ text: '🔄 Check Payment Status', callback_data: `checkinvoice_${invoice.invoice_id}` }]);
                        }
                        
                        if (trc20Wallet) {
                            keyboard.inline_keyboard.push([{ text: '🏦 Pay Directly (TrustWallet)', callback_data: `directpay_TRC20_${productId}_${shortage}` }]);
                        }
                        
                        if (binanceUid) {
                            keyboard.inline_keyboard.push([{ text: '🟡 Pay via Binance Pay', callback_data: `directpay_BINANCE_${productId}_${shortage}` }]);
                        }
                        
                        if (messageToEdit) return bot.editMessageText(payMsg, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML', reply_markup: keyboard });
                        return bot.sendMessage(chatId, payMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                    } else {
                        // Fallback if API fails but direct pay is enabled
                        if (trc20Wallet || binanceUid) {
                             const payMsg = `⚠️ <b>Insufficient Balance</b>\n\nYour Balance: $${user.balance.toFixed(2)}\nProduct Cost: $${costUsd.toFixed(2)}\n\n💳 <b>Direct Checkout:</b>\nPay exactly <b>$${shortage.toFixed(2)} USDT</b> via the buttons below to instantly receive your product!`;
                             const keyboard = { inline_keyboard: [] };
                             if (trc20Wallet) keyboard.inline_keyboard.push([{ text: '🏦 Pay Directly (TrustWallet)', callback_data: `directpay_TRC20_${productId}_${shortage}` }]);
                             if (binanceUid) keyboard.inline_keyboard.push([{ text: '🟡 Pay via Binance Pay', callback_data: `directpay_BINANCE_${productId}_${shortage}` }]);
                             
                             if (messageToEdit) return bot.editMessageText(payMsg, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML', reply_markup: keyboard });
                             return bot.sendMessage(chatId, payMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                        }
                        return bot.sendMessage(chatId, '❌ Failed to generate payment invoice.');
                    }
                } catch(e) {
                    if (trc20Wallet || binanceUid) {
                         const payMsg = `⚠️ <b>Insufficient Balance</b>\n\nYour Balance: $${user.balance.toFixed(2)}\nProduct Cost: $${costUsd.toFixed(2)}\n\n💳 <b>Direct Checkout:</b>\nPay exactly <b>$${shortage.toFixed(2)} USDT</b> via the buttons below to instantly receive your product!`;
                         const keyboard = { inline_keyboard: [] };
                         if (trc20Wallet) keyboard.inline_keyboard.push([{ text: '🏦 Pay Directly (TrustWallet)', callback_data: `directpay_TRC20_${productId}_${shortage}` }]);
                         if (binanceUid) keyboard.inline_keyboard.push([{ text: '🟡 Pay via Binance Pay', callback_data: `directpay_BINANCE_${productId}_${shortage}` }]);
                         
                         if (messageToEdit) return bot.editMessageText(payMsg, { chat_id: chatId, message_id: messageToEdit, parse_mode: 'HTML', reply_markup: keyboard });
                         return bot.sendMessage(chatId, payMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                    }
                    return bot.sendMessage(chatId, '❌ Payment gateway error.');
                }
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
                    bot.sendMessage(chatId, '❌ Product not found or unavailable.');
                    return;
                }
                
                const priceDisplay = product.retail_price !== undefined ? `$${product.retail_price.toFixed(2)}` : 'N/A';
                
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
                            
                            // Check if this was a Direct Checkout
                            if (dbInvoice.target_product_id) {
                                bot.editMessageText(`✅ **Payment Successful!**\n\n$${dbInvoice.amount.toFixed(2)} received. Delivering your product now... ⚡`, {
                                    chat_id: chatId,
                                    message_id: messageId,
                                    parse_mode: 'Markdown'
                                });
                                // Immediately trigger the purchase using the new balance
                                await processPurchase(chatId, dbInvoice.target_product_id, 1, query.from, null);
                            } else {
                                bot.editMessageText(`✅ **Payment Successful!**\n\n$${dbInvoice.amount.toFixed(2)} has been added to your wallet!`, {
                                    chat_id: chatId,
                                    message_id: messageId,
                                    parse_mode: 'Markdown'
                                });
                            }
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
            else if (data.startsWith('directpay_TRC20_')) {
                const parts = data.split('_');
                const productId = parts[2];
                const shortage = parseFloat(parts[3]);
                bot.answerCallbackQuery(query.id);

                const trc20Setting = await Setting.findOne({ key: 'trc20_wallet' });
                if (!trc20Setting || !trc20Setting.value) return bot.sendMessage(chatId, '❌ TRC20 Wallet not configured.');
                
                const address = trc20Setting.value;
                const msg = `🏦 **Direct Crypto Payment (USDT TRC20)**\n\n` +
                            `Please send EXACTLY **${shortage.toFixed(2)} USDT** on the **Tron (TRC20)** network to the address below:\n\n` +
                            `\`${address}\`\n\n` +
                            `⚠️ *IMPORTANT:* Send only USDT on the TRC20 network. Wait for the transaction to be successful on Binance/TrustWallet.\n\n` +
                            `Once sent, click the button below to submit your Transaction Hash (TxID) for automatic verification.`;
                
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '✅ I have sent the USDT', callback_data: `submittx_${productId}_${shortage}` }],
                        [{ text: '🔙 Cancel', callback_data: 'cmd_products' }]
                    ]
                };
                
                bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
            }
            else if (data.startsWith('directpay_BINANCE_')) {
                const parts = data.split('_');
                const productId = parts[2];
                const shortage = parseFloat(parts[3]);
                bot.answerCallbackQuery(query.id);

                const binanceSetting = await Setting.findOne({ key: 'binance_uid' });
                if (!binanceSetting || !binanceSetting.value) return bot.sendMessage(chatId, '❌ Binance Pay UID not configured.');
                
                const uid = binanceSetting.value;
                const orderId = `BIN_${Date.now().toString().slice(-6)}`;
                
                const msg = `◇ Payment via Binance Pay\n\n` +
                            `🧾 🔖 Order: #${orderId}\n` +
                            `◇ Binance ID (tap to copy):\n` +
                            `\`${uid}\`\n` +
                            `💰 Amount to transfer: $${shortage.toFixed(2)}\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `📝 Instructions:\n` +
                            `1️⃣ Send the exact amount (USDT or USDC only) via Binance Pay\n` +
                            `2️⃣ After payment, click the button below to submit the Order ID / Transaction Reference.`;
                
                const keyboard = {
                    inline_keyboard: [
                        [{ text: '✅ I have sent the payment', callback_data: `submitbinance_${productId}_${shortage}` }],
                        [{ text: '🔙 Cancel', callback_data: 'cmd_products' }]
                    ]
                };
                
                bot.editMessageText(msg, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
            }
            else if (data.startsWith('submitbinance_')) {
                const parts = data.split('_');
                const productId = parts[1];
                const shortage = parts[2];
                bot.answerCallbackQuery(query.id);
                
                bot.sendMessage(chatId, `🔍 **Please reply to this message with your Binance Pay Order ID or Transaction Reference.**\n\n*(Amount expected: $${shortage} | PID: ${productId} | Type: BINANCE)*`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        force_reply: true,
                        input_field_placeholder: 'Paste your Binance Order ID here...'
                    }
                });
            }
            else if (data.startsWith('submittx_')) {
                const parts = data.split('_');
                const productId = parts[1];
                const shortage = parts[2];
                bot.answerCallbackQuery(query.id);
                
                bot.sendMessage(chatId, `🔍 **Please reply to this message with your Transaction Hash (TxID) for verification.**\n\n*(Amount expected: $${shortage} | PID: ${productId})*`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        force_reply: true,
                        input_field_placeholder: 'Paste your TxID/Hash here...'
                    }
                });
            }
            else if (data.startsWith('approvepay_')) {
                if (!ADMIN_ID || query.from.id !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: 'Unauthorized', show_alert: true });
                
                const invoiceId = data.split('_')[1];
                bot.answerCallbackQuery(query.id);
                
                const dbInvoice = await Invoice.findOne({ invoice_id: invoiceId });
                if (!dbInvoice || dbInvoice.status === 'paid') return bot.editMessageText('❌ Invoice already processed or not found.', { chat_id: query.message.chat.id, message_id: query.message.message_id });
                
                await Invoice.updateOne({ invoice_id: invoiceId }, { status: 'paid' });
                await User.updateOne({ id: dbInvoice.user_id }, { $inc: { balance: dbInvoice.amount } });
                
                bot.editMessageText(query.message.text + '\n\n✅ **APPROVED. Product is being delivered to user.**', { chat_id: query.message.chat.id, message_id: query.message.message_id });
                
                bot.sendMessage(dbInvoice.user_id, `✅ **Your Binance Pay payment has been approved!**\n\n$${dbInvoice.amount.toFixed(2)} received. Delivering your product now... ⚡`, { parse_mode: 'Markdown' });
                
                // Create a fake fromUser object to satisfy processPurchase
                const fakeFromUser = { id: dbInvoice.user_id, username: `user_${dbInvoice.user_id}` };
                await processPurchase(dbInvoice.user_id, dbInvoice.target_product_id, 1, fakeFromUser, null);
            }
            else if (data.startsWith('rejectpay_')) {
                if (!ADMIN_ID || query.from.id !== ADMIN_ID) return bot.answerCallbackQuery(query.id, { text: 'Unauthorized', show_alert: true });
                
                const invoiceId = data.split('_')[1];
                bot.answerCallbackQuery(query.id);
                
                const dbInvoice = await Invoice.findOne({ invoice_id: invoiceId });
                if (!dbInvoice || dbInvoice.status !== 'pending_approval') return bot.editMessageText('❌ Invoice already processed or not found.', { chat_id: query.message.chat.id, message_id: query.message.message_id });
                
                await Invoice.updateOne({ invoice_id: invoiceId }, { status: 'rejected' });
                
                bot.editMessageText(query.message.text + '\n\n❌ **REJECTED.**', { chat_id: query.message.chat.id, message_id: query.message.message_id });
                
                bot.sendMessage(dbInvoice.user_id, `❌ **Your payment was rejected by the admin.**\n\nIf you believe this is a mistake, please contact support and provide proof of payment.`, { parse_mode: 'Markdown' });
            }
        } catch (e) {
            console.error('Error handling callback query:', e.message);
            bot.answerCallbackQuery(query.id, { text: 'An error occurred.', show_alert: true });
        }
    });

    // Stateless Message Handler for Replies (Vercel Serverless Compatible)
    bot.on('message', async (msg) => {
        // Only process text messages that are replies
        if (!msg.text || !msg.reply_to_message || !msg.reply_to_message.text) return;
        
        const replyText = msg.reply_to_message.text;
        
        // Handle TRC20 TXID
        if (replyText.includes('Transaction Hash (TxID)')) {
            const chatId = msg.chat.id;
            const txid = msg.text.trim();
            
            const amountMatch = replyText.match(/\$([\d\.]+)/);
            const pidMatch = replyText.match(/PID: (\d+)/);
            
            if (!amountMatch || !pidMatch) {
                return bot.sendMessage(chatId, "❌ Error parsing product details. Please click 'I have sent the USDT' again.");
            }
            
            const expectedAmount = parseFloat(amountMatch[1]);
            const productId = parseInt(pidMatch[1]);
            
            bot.sendMessage(chatId, `⏳ Checking blockchain for TxID: \`${txid}\`... This may take a moment.`, { parse_mode: 'Markdown' });
            
            try {
                const trc20Setting = await Setting.findOne({ key: 'trc20_wallet' });
                const expectedAddress = trc20Setting ? trc20Setting.value : null;
                
                if (!expectedAddress) return bot.sendMessage(chatId, `❌ Admin wallet not configured.`);
                
                // Check if TxID was already used
                const existing = await Invoice.findOne({ txid: txid });
                if (existing) {
                    return bot.sendMessage(chatId, `❌ This Transaction Hash has already been used!`);
                }
                
                // Fetch from Tronscan
                const res = await axios.get(`https://apilist.tronscan.org/api/transaction-info?hash=${txid}`);
                if (!res.data || Object.keys(res.data).length === 0) {
                    return bot.sendMessage(chatId, `❌ Transaction not found on Tron network. Are you sure this is a TRC20 TxID?`);
                }
                
                const tx = res.data;
                if (tx.contractRet !== 'SUCCESS') return bot.sendMessage(chatId, `❌ Transaction failed or is still pending on blockchain.`);
                
                if (!tx.trc20TransferInfo || tx.trc20TransferInfo.length === 0) {
                    return bot.sendMessage(chatId, `❌ No TRC20 token transfer found in this transaction.`);
                }
                
                // USDT Contract Address on Tron
                const usdtTransfer = tx.trc20TransferInfo.find(t => t.contract_address === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
                if (!usdtTransfer) return bot.sendMessage(chatId, `❌ No USDT transfer found in this transaction.`);
                
                if (usdtTransfer.to_address !== expectedAddress) {
                    return bot.sendMessage(chatId, `❌ Funds were NOT sent to the correct admin wallet!`);
                }
                
                const amountSent = parseFloat(usdtTransfer.amount_str) / 1000000;
                if (amountSent < (expectedAmount - 0.05)) { // 5 cents tolerance
                    return bot.sendMessage(chatId, `❌ Insufficient amount. Expected $${expectedAmount.toFixed(2)}, but received $${amountSent.toFixed(2)}.`);
                }
                
                // Success! Save to DB to prevent reuse
                await Invoice.create({
                    invoice_id: `trc20_${txid}`,
                    amount: amountSent,
                    user_id: chatId,
                    target_product_id: productId,
                    txid: txid,
                    status: 'paid'
                });
                
                await User.updateOne({ id: chatId }, { $inc: { balance: amountSent } });
                
                bot.sendMessage(chatId, `✅ **Blockchain Verification Successful!**\n\n$${amountSent.toFixed(2)} USDT received. Delivering your product now... ⚡`, { parse_mode: 'Markdown' });
                
                // Immediately purchase
                await processPurchase(chatId, productId, 1, msg.from, null);
                
            } catch (err) {
                console.error(err);
                bot.sendMessage(chatId, `❌ API Error while verifying transaction. Please try submitting again later or contact support.`);
            }
        }
        
        // Handle Binance Pay Order ID (Admin Approval)
        if (replyText.includes('Binance Pay Order ID or Transaction Reference')) {
            const chatId = msg.chat.id;
            const orderId = msg.text.trim();
            
            const amountMatch = replyText.match(/\$([\d\.]+)/);
            const pidMatch = replyText.match(/PID: (\d+)/);
            
            if (!amountMatch || !pidMatch) {
                return bot.sendMessage(chatId, "❌ Error parsing product details. Please try again.");
            }
            
            const expectedAmount = parseFloat(amountMatch[1]);
            const productId = parseInt(pidMatch[1]);
            
            if (!ADMIN_ID) return bot.sendMessage(chatId, `❌ Admin ID not configured. Cannot process manual approval.`);
            
            // Save pending invoice
            const invoice_id = `binance_${Date.now()}`;
            await Invoice.create({
                invoice_id: invoice_id,
                amount: expectedAmount,
                user_id: chatId,
                target_product_id: productId,
                txid: orderId,
                status: 'pending_approval'
            });
            
            bot.sendMessage(chatId, `⏳ **Payment Submitted!**\n\nYour Binance Pay Order ID \`${orderId}\` has been sent to the Admin for verification. Your product will be delivered automatically as soon as it is approved.`, { parse_mode: 'Markdown' });
            
            // Ping Admin
            const adminMsg = `🟡 **New Binance Pay Payment** 🟡\n\n` +
                             `**User ID:** ${chatId}\n` +
                             `**Amount Expected:** $${expectedAmount.toFixed(2)}\n` +
                             `**Product ID:** ${productId}\n` +
                             `**Submitted Order ID:** \`${orderId}\`\n\n` +
                             `Please check your Binance App. If the money has arrived, click Approve to automatically deliver the product.`;
                             
            const adminKeyboard = {
                inline_keyboard: [
                    [{ text: '✅ Approve Payment', callback_data: `approvepay_${invoice_id}` }],
                    [{ text: '❌ Reject Payment', callback_data: `rejectpay_${invoice_id}` }]
                ]
            };
            
            bot.sendMessage(ADMIN_ID, adminMsg, { parse_mode: 'Markdown', reply_markup: adminKeyboard });
        }
    });

    bot.on('error', (error) => console.error('General Error:', error.code, error.message));
    process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

module.exports = app;
