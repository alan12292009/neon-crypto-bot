const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7965716660:AAHExQooYGa2zT_bueGmKxnri9GDOaAeKXE';

// Инициализируем бота с polling - ВАЖНО!
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

console.log('🤖 Telegram Bot started with polling...');

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
    
    console.log('👤 New user initialized:', { 
      userId, 
      username: users[userId].username 
    });
  }
  return users[userId];
}

function generateCheckId() {
  return 'CH' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// Команды бота
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId, msg.from);
  
  const welcomeMessage = `
🎉 *Добро пожаловать в NeonCrypto!*

Ваш баланс:
₿ BTC: ${user.balance.BTC}
Ξ ETH: ${user.balance.ETH}
💵 USDT: ${user.balance.USDT}
🪙 LCOIN: ${user.balance.LCOIN}

*Доступные команды:*
/balance - Показать баланс
/transfer - Перевод средств
/checks - Работа с чеками
/stats - Статистика

💡 *Откройте веб-приложение для полного функционала!*
  `;
  
  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Открыть веб-приложение', web_app: { url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'licryptobot.onrender.com'}` } }],
        [{ text: '💰 Баланс', callback_data: 'balance' }, { text: '🔄 Перевод', callback_data: 'transfer' }]
      ]
    }
  });
});

bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  const user = initUser(chatId, msg.from);
  
  const balanceMessage = `
💼 *Ваш баланс:*

₿ Bitcoin: *${user.balance.BTC}*
Ξ Ethereum: *${user.balance.ETH}*
💵 Tether: *${user.balance.USDT}*
🪙 LCoin: *${user.balance.LCOIN}*

Уровень: *${user.level}*
Опыт: *${user.xp} XP*
  `;
  
  bot.sendMessage(chatId, balanceMessage, { parse_mode: 'Markdown' });
});

bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  
  if (data === 'balance') {
    const user = initUser(chatId, callbackQuery.from);
    const balanceMessage = `
💼 *Баланс:*
₿ BTC: ${user.balance.BTC}
Ξ ETH: ${user.balance.ETH}  
💵 USDT: ${user.balance.USDT}
🪙 LCOIN: ${user.balance.LCOIN}
    `;
    
    bot.sendMessage(chatId, balanceMessage, { parse_mode: 'Markdown' });
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Главная страница
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

app.post('/api/transfer', async (req, res) => {
  const { fromUserId, toUsername, currency, amount, message } = req.body;

  console.log('🔧 Transfer attempt:', { fromUserId, toUsername, currency, amount });

  try {
    // Убираем @ из username если есть
    const cleanUsername = toUsername.replace('@', '').trim();
    
    // Ищем получателя по username
    const toUserEntry = Object.entries(users).find(([userId, user]) => 
      user.username && user.username.toLowerCase() === cleanUsername.toLowerCase()
    );

    if (!toUserEntry) {
      console.log('❌ User not found:', cleanUsername);
      return res.status(400).json({ error: '👤 Пользователь не найден' });
    }

    const [toUserId, toUser] = toUserEntry;
    const fromUser = users[fromUserId];

    if (!fromUser) {
      console.log('❌ From user not found:', fromUserId);
      return res.status(400).json({ error: '❌ Отправитель не найден' });
    }

    // Проверяем баланс
    if (!fromUser.balance[currency] || fromUser.balance[currency] < amount) {
      console.log('❌ Insufficient funds:', { 
        has: fromUser.balance[currency], 
        needed: amount 
      });
      return res.status(400).json({ error: '❌ Недостаточно средств' });
    }

    // Выполняем перевод
    fromUser.balance[currency] = parseFloat((fromUser.balance[currency] - amount).toFixed(8));
    toUser.balance[currency] = parseFloat((toUser.balance[currency] + amount).toFixed(8));
    fromUser.xp += 10;

    // Создаем транзакцию
    const transaction = {
      id: Date.now(),
      type: 'user_transfer',
      from: fromUserId,
      fromName: fromUser.first_name || fromUser.username || 'Unknown',
      to: toUserId,
      toName: toUser.first_name || toUser.username || 'Unknown',
      currency,
      amount: parseFloat(amount),
      message: message || '',
      timestamp: new Date()
    };
    transactions.push(transaction);

    console.log('✅ Transfer successful:', {
      from: fromUser.username,
      to: toUser.username,
      currency,
      amount,
      newBalanceFrom: fromUser.balance[currency],
      newBalanceTo: toUser.balance[currency]
    });

    // Уведомляем пользователей через бота
    try {
      await bot.sendMessage(
        fromUserId, 
        `✅ Перевод выполнен!\n${amount} ${currency} → @${toUser.username}\nНовый баланс: ${fromUser.balance[currency]} ${currency}\n+10 XP 🎉`
      );
      
      await bot.sendMessage(
        toUserId, 
        `💸 Вам перевели ${amount} ${currency} от @${fromUser.username || fromUser.first_name}\nТекущий баланс: ${toUser.balance[currency]} ${currency}`
      );
    } catch (botError) {
      console.log('⚠️ Bot notification failed:', botError.message);
    }

    res.json({ 
      success: true, 
      newBalance: fromUser.balance, 
      transaction, 
      xp: fromUser.xp 
    });

  } catch (error) {
    console.log('❌ Transfer error:', error);
    res.status(500).json({ error: '❌ Ошибка перевода: ' + error.message });
  }
});

app.get('/api/crypto', async (req, res) => {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether,solana&vs_currencies=usd,rub&include_24hr_change=true'
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    users: Object.keys(users).length,
    bot: 'running'
  });
});

// Обработка ошибок бота
bot.on('error', (error) => {
  console.log('Bot error:', error);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Static files from: ${path.join(__dirname, 'public')}`);
  console.log(`🤖 Bot token: ${TOKEN ? 'SET' : 'MISSING'}`);
});
