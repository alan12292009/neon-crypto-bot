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

// Middleware - ИСПРАВЛЕННЫЙ ПУТЬ!
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Главная страница - ИСПРАВЛЕННЫЙ ПУТЬ!
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

    res.json({ success: true, newBalance: fromUser.balance, transaction, xp: fromUser.xp });
  } catch (error) {
    res.status(500).json({ error: '❌ Ошибка перевода' });
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
  res.json({ status: 'OK', timestamp: new Date() });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Static files from: ${path.join(__dirname, 'public')}`);
});
