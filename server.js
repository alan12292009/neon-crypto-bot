const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN = '7965716660:AAHExQooYGa2zT_bueGmKxnri9GDOaAeKXE';
const bot = new TelegramBot(TOKEN);

// База данных в памяти
let users = {};
let transactions = [];
let wallets = {};
let checks = {};

// Инициализация пользователя
function initUser(userId, userData) {
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      balance: {
        BTC: 0.1,
        ETH: 1.5,
        USDT: 1000,
        SOL: 5.0,
        LCOIN: 10000
      },
      username: userData?.username || '',
      first_name: userData?.first_name || '',
      level: 1,
      xp: 0
    };
    
    wallets[userId] = [
      {
        id: 'default',
        name: 'Основной кошелек',
        emoji: '💼',
        balance: { BTC: 0, ETH: 0, USDT: 0, SOL: 0, LCOIN: 0 },
        color: '#6366f1',
        createdAt: new Date()
      }
    ];
  }
  return users[userId];
}

function generateCheckId() {
  return 'CH' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Статические файлы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API routes
app.get('/api/user/:userId', (req, res) => {
  const userId = req.params.userId;
  const user = initUser(userId);
  const userWallets = wallets[userId] || [];
  
  res.json({ user: user, wallets: userWallets });
});

app.post('/api/wallet/create', (req, res) => {
  const { userId, name, emoji, color } = req.body;
  
  try {
    if (!wallets[userId]) wallets[userId] = [];
    
    const newWallet = {
      id: 'wallet_' + Date.now(),
      name: name,
      emoji: emoji,
      balance: { BTC: 0, ETH: 0, USDT: 0, SOL: 0, LCOIN: 0 },
      color: color || '#6366f1',
      createdAt: new Date()
    };
    
    wallets[userId].push(newWallet);
    users[userId].xp += 5;
    
    res.json({ success: true, wallet: newWallet, xp: users[userId].xp });
  } catch (error) {
    res.status(500).json({ error: '❌ Ошибка создания кошелька' });
  }
});

app.post('/api/transfer', async (req, res) => {
  const { fromUserId, toUsername, currency, amount, message } = req.body;

  try {
    const toUser = Object.values(users).find(user => 
      user.username === toUsername.replace('@', '')
    );

    if (!toUser) {
      return res.status(400).json({ error: '👤 Пользователь не найден' });
    }

    const fromUser = users[fromUserId];
    
    if (fromUser.balance[currency] < amount) {
      return res.status(400).json({ error: '❌ Недостаточно средств' });
    }

    fromUser.balance[currency] -= amount;
    toUser.balance[currency] += amount;
    fromUser.xp += 10;

    const transaction = {
      id: Date.now(),
      type: 'user_transfer',
      from: fromUserId,
      fromName: fromUser.first_name,
      to: toUser.id,
      toName: toUser.first_name,
      currency,
      amount,
      message,
      timestamp: new Date()
    };
    transactions.push(transaction);

    // Уведомления в Telegram
    try {
      await bot.sendMessage(toUser.id,
        `💸 **Вам перевод!**\n\n👤 От: **${fromUser.first_name}**\n💰 Сумма: **${amount} ${currency}**\n💬 ${message || 'Без сообщения'}\n\n🕐 ${new Date().toLocaleTimeString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {}

    try {
      await bot.sendMessage(fromUser.id,
        `✅ **Перевод выполнен!**\n\n👤 Кому: **${toUser.first_name}**\n💰 Сумма: **${amount} ${currency}**\n💬 ${message || 'Без сообщения'}\n\n🕐 ${new Date().toLocaleTimeString()}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {}

    res.json({ success: true, newBalance: fromUser.balance, transaction, xp: fromUser.xp });
  } catch (error) {
    res.status(500).json({ error: '❌ Ошибка перевода' });
  }
});

app.post('/api/check/create', async (req, res) => {
  const { userId, currency, amount, message } = req.body;
  
  try {
    const user = users[userId];
    
    if (user.balance[currency] < amount) {
      return res.status(400).json({ error: '❌ Недостаточно средств' });
    }
    
    user.balance[currency] -= amount;
    
    const checkId = generateCheckId();
    const check = {
      id: checkId,
      createdBy: userId,
      creatorName: user.first_name,
      currency,
      amount,
      message: message || '',
      createdAt: new Date(),
      claimedBy: null,
      claimedAt: null
    };
    
    checks[checkId] = check;
    const botUsername = (await bot.getMe()).username;
    const checkLink = `https://t.me/${botUsername}?start=check_${checkId}`;
    
    res.json({ success: true, check: check, checkLink: checkLink, newBalance: user.balance });
  } catch (error) {
    res.status(500).json({ error: '❌ Ошибка создания чека' });
  }
});

app.get('/api/crypto', async (req, res) => {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,solana,litecoin&vs_currencies=usd,rub&include_24hr_change=true'
    );
    
    const data = response.data;
    data.lcoin = {
      usd: 0.5 + Math.random() * 0.1,
      rub: (0.5 + Math.random() * 0.1) * 90,
      usd_24h_change: (Math.random() - 0.5) * 20
    };
    
    res.json(data);
  } catch (error) {
    res.json({
      bitcoin: { usd: 45000, rub: 4050000, usd_24h_change: 2.5 },
      ethereum: { usd: 3000, rub: 270000, usd_24h_change: 1.8 },
      tether: { usd: 1, rub: 90, usd_24h_change: 0.1 },
      solana: { usd: 100, rub: 9000, usd_24h_change: 5.2 },
      lcoin: { usd: 0.5, rub: 45, usd_24h_change: 3.7 }
    });
  }
});

// Команды бота
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId, msg.from);
  
  const keyboard = {
    inline_keyboard: [[
      {
        text: '🚀 Открыть крипто-бот',
        web_app: { url: process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}` }
      }
    ]]
  };

  await bot.sendMessage(chatId, 
    `🌟 Добро пожаловать в NeonCrypto Bot!\n\n` +
    `💎 Ваш баланс:\n` +
    `₿ BTC: ${user.balance.BTC}\n` +
    `🔷 ETH: ${user.balance.ETH}\n` +
    `💳 USDT: ${user.balance.USDT}\n` +
    `🪙 LCOIN: ${user.balance.LCOIN}\n\n` +
    `✨ Откройте мини-приложение для управления!`,
    { reply_markup: keyboard }
  );
});

bot.onText(/\/check_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const checkId = match[1];
  const check = checks[checkId];
  
  if (!check || check.claimedBy) {
    return bot.sendMessage(chatId, '❌ Чек не найден или уже использован');
  }
  
  const user = initUser(chatId, msg.from);
  user.balance[check.currency] += check.amount;
  check.claimedBy = chatId;
  check.claimedAt = new Date();
  
  const transaction = {
    id: Date.now(),
    type: 'check_claim',
    from: check.createdBy,
    to: chatId,
    currency: check.currency,
    amount: check.amount,
    message: `Чек: ${check.message || 'Без сообщения'}`,
    timestamp: new Date()
  };
  transactions.push(transaction);
  
  try {
    await bot.sendMessage(check.createdBy,
      `🎉 **Чек использован!**\n\n👤 ${user.first_name}\n💸 ${check.amount} ${check.currency}\n📝 ${checkId}`
    );
  } catch (error) {}
  
  await bot.sendMessage(chatId,
    `🎊 **Чек активирован!**\n\n💸 ${check.amount} ${check.currency}\n👤 От: ${check.creatorName}\n💬 ${check.message || 'Без сообщения'}\n\n💰 Баланс: ${user.balance[check.currency]} ${check.currency}`
  );
});

// Webhook route для Telegram
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Webhook URL: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}`);
});