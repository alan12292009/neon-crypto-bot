const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7965716660:AAHExQooYGa2zT_bueGmKxnri9GDOaAeKXE';
const ADMIN_USERNAME = 'ScarletID';

// Инициализируем бота с polling
const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

console.log('🤖 LiCrypto Bot started with polling...');

// База данных в памяти
let users = {};
let transactions = [];
let wallets = {};
let checks = {};
let pendingTransfers = {};
let blockedUsers = {};

// Инициализация пользователя
function initUser(userId, userData = {}) {
  if (!users[userId]) {
    const isAdmin = userData.username === ADMIN_USERNAME;
    
    users[userId] = {
      id: userId,
      balance: {
        BTC: isAdmin ? 10 : 0,
        ETH: isAdmin ? 10 : 0,
        USDT: isAdmin ? 10000 : 1,
        SOL: isAdmin ? 10 : 0,
        LCOIN: isAdmin ? 100000 : 0
      },
      username: userData.username || '',
      first_name: userData.first_name || '',
      level: 1,
      xp: 0,
      lastTransfer: null,
      isAdmin: isAdmin,
      createdAt: new Date()
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
      username: users[userId].username,
      isAdmin: users[userId].isAdmin
    });
  }
  return users[userId];
}

// Проверка на блокировку
function isUserBlocked(userId) {
  return blockedUsers[userId] && blockedUsers[userId].isBlocked;
}

// Получение информации о блокировке
function getBlockInfo(userId) {
  return blockedUsers[userId];
}

// Блокировка пользователя
function blockUser(userId, reason, adminId) {
  blockedUsers[userId] = {
    isBlocked: true,
    reason: reason,
    blockedBy: adminId,
    blockedAt: new Date(),
    blockedUntil: null
  };
  
  console.log(`🔒 User ${userId} blocked by ${adminId}. Reason: ${reason}`);
}

// Разблокировка пользователя
function unblockUser(userId, adminId) {
  if (blockedUsers[userId]) {
    blockedUsers[userId].isBlocked = false;
    blockedUsers[userId].unblockedBy = adminId;
    blockedUsers[userId].unblockedAt = new Date();
    
    console.log(`🔓 User ${userId} unblocked by ${adminId}`);
    return true;
  }
  return false;
}

function generateCheckId() {
  return 'CH' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

function generateTransferId() {
  return 'TR' + Date.now() + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// Мидлварь для проверки блокировки
function checkBlockStatus(msg) {
  const userId = msg.chat.id;
  if (isUserBlocked(userId)) {
    const blockInfo = getBlockInfo(userId);
    const adminUser = users[blockInfo.blockedBy];
    const blockMessage = `🚫 *Вы заблокированы в боте*\n\n📋 *Причина:* ${blockInfo.reason}\n⏰ *Дата блокировки:* ${new Date(blockInfo.blockedAt).toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${adminUser?.username || 'администратор'}\n\n💡 *Для разблокировки обратитесь к администратору*`;
    
    bot.sendMessage(userId, blockMessage, { parse_mode: 'Markdown' });
    return true;
  }
  return false;
}

// Команды бота
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const user = initUser(chatId, msg.from);
  
  let adminMessage = '';
  if (user.isAdmin) {
    adminMessage = '\n\n⚡ *Вы администратор системы!*\nИспользуйте /admin для управления';
  }
  
  const welcomeMessage = `
🎉 *Добро пожаловать в LiCrypto!*

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
/history - История операций${adminMessage}

💡 *Откройте веб-приложение для полного функционала!*
  `;
  
  bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📱 Открыть веб-приложение', web_app: { url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'licryptobot.onrender.com'}` } }],
        [{ text: '💰 Баланс', callback_data: 'balance' }, { text: '📊 История', callback_data: 'history' }]
      ]
    }
  });
});

// Админ панель
bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const user = initUser(chatId, msg.from);
  
  if (!user.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*\nЭта команда только для администраторов.', { parse_mode: 'Markdown' });
  }
  
  const blockedCount = Object.values(blockedUsers).filter(u => u.isBlocked).length;
  
  const adminMessage = `
⚡ *Панель администратора*

Статистика системы:
👥 Пользователей: ${Object.keys(users).length}
🔒 Заблокировано: ${blockedCount}
💼 Транзакций: ${transactions.length}
🎫 Активных чеков: ${Object.values(checks).filter(c => !c.activated).length}

*Команды админа:*
/add @username BTC 0.1 - Выдать криптовалюту
/block @username причина - Заблокировать
/unblock @username - Разблокировать
/users - Список пользователей
  `;
  
  bot.sendMessage(chatId, adminMessage, { parse_mode: 'Markdown' });
});

// Блокировка пользователя
bot.onText(/\/block (@\w+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const adminUser = initUser(chatId, msg.from);
  
  if (!adminUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const targetUsername = match[1].replace('@', '');
  const reason = match[2];
  
  const targetUser = Object.values(users).find(u => 
    u.username && u.username.toLowerCase() === targetUsername.toLowerCase()
  );
  
  if (!targetUser) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не найден.`);
  }
  
  if (targetUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ Нельзя заблокировать администратора!');
  }
  
  if (isUserBlocked(targetUser.id)) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} уже заблокирован.`);
  }
  
  blockUser(targetUser.id, reason, adminUser.id);
  
  bot.sendMessage(chatId, `🔒 Пользователь @${targetUsername} заблокирован.\n📋 Причина: ${reason}`);
  
  const blockMessage = `🚫 *Вы были заблокированы в боте*\n\n📋 *Причина:* ${reason}\n⏰ *Дата блокировки:* ${new Date().toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${adminUser.username}\n\n💡 *Для разблокировки обратитесь к администратору*`;
  bot.sendMessage(targetUser.id, blockMessage, { parse_mode: 'Markdown' });
});

// Разблокировка пользователя
bot.onText(/\/unblock (@\w+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const adminUser = initUser(chatId, msg.from);
  
  if (!adminUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const targetUsername = match[1].replace('@', '');
  
  const targetUser = Object.values(users).find(u => 
    u.username && u.username.toLowerCase() === targetUsername.toLowerCase()
  );
  
  if (!targetUser) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не найден.`);
  }
  
  if (!isUserBlocked(targetUser.id)) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не заблокирован.`);
  }
  
  const success = unblockUser(targetUser.id, adminUser.id);
  
  if (success) {
    bot.sendMessage(chatId, `🔓 Пользователь @${targetUsername} разблокирован.`);
    
    const unblockMessage = `🎉 *Вы были разблокированы в боте!*\n\n✅ Теперь вы снова можете пользоваться всеми функциями бота.\n👮 *Разблокировал:* @${adminUser.username}\n\n💡 Добро пожаловать обратно!`;
    bot.sendMessage(targetUser.id, unblockMessage, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, `❌ Ошибка при разблокировке пользователя @${targetUsername}`);
  }
});

// Выдача криптовалюты админом
bot.onText(/\/add (@\w+) (\w+) (\d+\.?\d*)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const adminUser = initUser(chatId, msg.from);
  
  if (!adminUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const targetUsername = match[1].replace('@', '');
  const currency = match[2].toUpperCase();
  const amount = parseFloat(match[3]);
  
  const targetUser = Object.values(users).find(u => 
    u.username && u.username.toLowerCase() === targetUsername.toLowerCase()
  );
  
  if (!targetUser) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не найден.`);
  }
  
  if (isUserBlocked(targetUser.id)) {
    return bot.sendMessage(chatId, `❌ Нельзя выдать крипту заблокированному пользователю @${targetUsername}`);
  }
  
  if (!['BTC', 'ETH', 'USDT', 'LCOIN'].includes(currency)) {
    return bot.sendMessage(chatId, '❌ Неверная валюта. Используйте: BTC, ETH, USDT, LCOIN');
  }
  
  // Выдаем крипту
  targetUser.balance[currency] = (targetUser.balance[currency] || 0) + amount;
  
  // Записываем транзакцию
  const transaction = {
    id: Date.now(),
    type: 'admin_grant',
    from: 'SYSTEM',
    fromName: 'Система',
    to: targetUser.id,
    toName: targetUser.first_name || targetUser.username,
    currency: currency,
    amount: amount,
    message: `Выдано администратором @${adminUser.username}`,
    timestamp: new Date(),
    status: 'completed'
  };
  transactions.push(transaction);
  
  // Уведомляем пользователей
  bot.sendMessage(chatId, `✅ Выдано ${amount} ${currency} пользователю @${targetUsername}\nНовый баланс: ${targetUser.balance[currency]} ${currency}`);
  bot.sendMessage(targetUser.id, `🎉 Администратор выдал вам ${amount} ${currency}!\n\nНовый баланс ${currency}: ${targetUser.balance[currency]}`);
});

bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
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

// История операций
bot.onText(/\/history/, (msg) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const user = initUser(chatId, msg.from);
  
  const userTransactions = transactions
    .filter(t => t.from === user.id || t.to === user.id)
    .slice(-10)
    .reverse();
  
  if (userTransactions.length === 0) {
    return bot.sendMessage(chatId, '📊 *История операций*\n\nОпераций пока нет.', { parse_mode: 'Markdown' });
  }
  
  let historyMessage = '📊 *Последние операции:*\n\n';
  
  userTransactions.forEach((t, index) => {
    const date = new Date(t.timestamp).toLocaleDateString('ru-RU');
    const time = new Date(t.timestamp).toLocaleTimeString('ru-RU');
    const type = t.from === user.id ? '📤 Отправка' : '📥 Получение';
    const counterparty = t.from === user.id ? `→ @${t.toName}` : `← @${t.fromName}`;
    
    historyMessage += `${index + 1}. ${type} ${t.amount} ${t.currency}\n`;
    historyMessage += `   ${counterparty}\n`;
    if (t.message) historyMessage += `   💬 "${t.message}"\n`;
    historyMessage += `   📅 ${date} ${time}\n\n`;
  });
  
  bot.sendMessage(chatId, historyMessage, { parse_mode: 'Markdown' });
});

// Список пользователей для админа
bot.onText(/\/users/, (msg) => {
  const chatId = msg.chat.id;
  
  if (checkBlockStatus(msg)) return;
  
  const user = initUser(chatId, msg.from);
  
  if (!user.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const userList = Object.values(users)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
  
  let usersMessage = '👥 *Последние пользователи:*\n\n';
  
  userList.forEach((u, index) => {
    const status = isUserBlocked(u.id) ? '🔒' : '✅';
    const adminBadge = u.isAdmin ? ' 👮' : '';
    usersMessage += `${index + 1}. ${status} @${u.username || 'no_username'}${adminBadge}\n`;
    usersMessage += `   💰 ${u.balance.USDT} USDT | 🎯 Ур. ${u.level}\n\n`;
  });
  
  bot.sendMessage(chatId, usersMessage, { parse_mode: 'Markdown' });
});

bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  
  if (isUserBlocked(chatId)) {
    const blockInfo = getBlockInfo(chatId);
    const adminUser = users[blockInfo.blockedBy];
    const blockMessage = `🚫 *Вы заблокированы в боте*\n\n📋 *Причина:* ${blockInfo.reason}\n⏰ *Дата блокировки:* ${new Date(blockInfo.blockedAt).toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${adminUser?.username || 'администратор'}\n\n💡 *Для разблокировки обратитесь к администратору*`;
    
    bot.sendMessage(chatId, blockMessage, { parse_mode: 'Markdown' });
    return;
  }
  
  const user = initUser(chatId, callbackQuery.from);
  
  if (data === 'balance') {
    const balanceMessage = `
💼 *Баланс:*
₿ BTC: ${user.balance.BTC}
Ξ ETH: ${user.balance.ETH}  
💵 USDT: ${user.balance.USDT}
🪙 LCOIN: ${user.balance.LCOIN}
    `;
    
    bot.sendMessage(chatId, balanceMessage, { parse_mode: 'Markdown' });
  }
  else if (data === 'history') {
    const userTransactions = transactions
      .filter(t => t.from === user.id || t.to === user.id)
      .slice(-5)
      .reverse();
    
    if (userTransactions.length === 0) {
      return bot.sendMessage(chatId, '📊 *История операций*\n\nОпераций пока нет.', { parse_mode: 'Markdown' });
    }
    
    let historyMessage = '📊 *Последние операции:*\n\n';
    
    userTransactions.forEach((t, index) => {
      const type = t.from === user.id ? '📤 Отправка' : '📥 Получение';
      const counterparty = t.from === user.id ? `→ @${t.toName}` : `← @${t.fromName}`;
      
      historyMessage += `${index + 1}. ${type} ${t.amount} ${t.currency}\n`;
      historyMessage += `   ${counterparty}\n`;
      if (t.message) historyMessage += `   💬 "${t.message}"\n\n`;
    });
    
    bot.sendMessage(chatId, historyMessage, { parse_mode: 'Markdown' });
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Страница активации чека с паролем
app.get('/check/:checkId', (req, res) => {
  const checkId = req.params.checkId;
  const check = checks[checkId];
  
  if (!check) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Чек не найден</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
          .error { color: #e74c3c; font-size: 24px; }
        </style>
      </head>
      <body>
        <div class="error">❌ Чек не найден или уже активирован</div>
      </body>
      </html>
    `);
  }
  
  if (check.activated) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Чек уже активирован</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
          .info { color: #f39c12; font-size: 24px; }
        </style>
      </head>
      <body>
        <div class="info">⚠️ Этот чек уже был активирован</div>
      </body>
      </html>
    `);
  }
  
  const hasPassword = !!check.password;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Активация чека</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
        .check { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
        .amount { font-size: 32px; color: #27ae60; font-weight: bold; margin: 20px 0; }
        .currency { font-size: 24px; color: #2c3e50; }
        .message { color: #7f8c8d; margin: 15px 0; }
        .input-field { width: 100%; padding: 12px; margin: 10px 0; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; }
        .btn { background: #3498db; color: white; border: none; padding: 15px 30px; border-radius: 10px; font-size: 18px; cursor: pointer; margin: 20px 0; }
        .btn:hover { background: #2980b9; }
        .btn:disabled { background: #bdc3c7; cursor: not-allowed; }
        .password-note { color: #e74c3c; font-size: 14px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="check">
        <h2>🎁 Крипто-чек</h2>
        <div class="amount">${check.amount} <span class="currency">${check.currency}</span></div>
        <div class="message">${check.message || 'Без сообщения'}</div>
        <div>От: ${check.creatorName}</div>
        
        ${hasPassword ? `
          <div class="password-note">🔒 Этот чек защищен паролем</div>
          <input type="password" id="checkPassword" class="input-field" placeholder="Введите пароль для активации">
        ` : ''}
        
        <button class="btn" onclick="activateCheck()" id="activateBtn">
          ${hasPassword ? '🔓 Активировать чек' : 'Активировать чек'}
        </button>
        <div id="result" style="margin-top: 15px;"></div>
      </div>
      
      <script>
        async function activateCheck() {
          const btn = document.getElementById('activateBtn');
          const result = document.getElementById('result');
          const passwordInput = document.getElementById('checkPassword');
          const password = passwordInput ? passwordInput.value : '';
          
          btn.disabled = true;
          btn.textContent = 'Активация...';
          
          try {
            const response = await fetch('/api/checks/activate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                checkId: '${checkId}',
                password: password
              })
            });
            
            const data = await response.json();
            
            if (data.success) {
              result.innerHTML = '<div style="color: #27ae60; font-weight: bold;">✅ Чек успешно активирован!</div>';
              result.innerHTML += '<div>Получено: ' + data.amount + ' ' + data.currency + '</div>';
              btn.style.display = 'none';
              if (passwordInput) passwordInput.style.display = 'none';
            } else {
              result.innerHTML = '<div style="color: #e74c3c;">❌ ' + data.error + '</div>';
              btn.disabled = false;
              btn.textContent = '${hasPassword ? '🔓 Активировать чек' : 'Активировать чек'}';
            }
          } catch (error) {
            result.innerHTML = '<div style="color: #e74c3c;">❌ Ошибка сети</div>';
            btn.disabled = false;
            btn.textContent = '${hasPassword ? '🔓 Активировать чек' : 'Активировать чек'}';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// API routes
app.get('/api/user/:userId', (req, res) => {
  const userId = req.params.userId;
  
  if (isUserBlocked(userId)) {
    return res.status(403).json({ 
      error: 'USER_BLOCKED',
      message: 'Пользователь заблокирован',
      blockInfo: getBlockInfo(userId)
    });
  }
  
  const user = users[userId] || initUser(userId, {});
  const userWallets = wallets[userId] || [];
  
  const userTransactions = transactions
    .filter(t => t.from === userId || t.to === userId)
    .slice(-20)
    .reverse()
    .map(t => ({
      ...t,
      type: t.from === userId ? 'outgoing' : 'incoming',
      counterparty: t.from === userId ? t.toName : t.fromName
    }));
  
  res.json({ 
    user: user, 
    wallets: userWallets,
    transactions: userTransactions,
    isBlocked: false
  });
});

app.post('/api/transfer/initiate', async (req, res) => {
  const { fromUserId, toUsername, currency, amount, message } = req.body;

  if (isUserBlocked(fromUserId)) {
    return res.status(403).json({ 
      error: 'USER_BLOCKED',
      message: 'Вы заблокированы и не можете совершать переводы'
    });
  }

  console.log('🔧 Transfer initiation:', { fromUserId, toUsername, currency, amount, message });

  try {
    const cleanUsername = toUsername.replace('@', '').trim();
    
    const toUserEntry = Object.entries(users).find(([userId, user]) => {
      if (!user.username) return false;
      return user.username.toLowerCase() === cleanUsername.toLowerCase();
    });

    if (!toUserEntry) {
      console.log('❌ User not found:', cleanUsername);
      return res.status(400).json({ error: '👤 Пользователь @' + cleanUsername + ' не найден. Убедитесь, что username правильный и пользователь запускал бота.' });
    }

    const [toUserId, toUser] = toUserEntry;
    
    if (isUserBlocked(toUserId)) {
      return res.status(400).json({ error: '❌ Получатель заблокирован в системе' });
    }

    const fromUser = users[fromUserId];

    if (!fromUser) {
      return res.status(400).json({ error: '❌ Отправитель не найден' });
    }

    if (!fromUser.balance[currency] || fromUser.balance[currency] < amount) {
      return res.status(400).json({ error: '❌ Недостаточно средств' });
    }

    const transferId = generateTransferId();
    pendingTransfers[transferId] = {
      id: transferId,
      fromUserId: fromUserId,
      toUserId: toUserId,
      toUsername: toUser.username,
      currency: currency,
      amount: parseFloat(amount),
      message: message || '',
      status: 'pending',
      createdAt: new Date(),
      willCompleteAt: new Date(Date.now() + 30000)
    };

    fromUser.balance[currency] = parseFloat((fromUser.balance[currency] - amount).toFixed(8));

    const transaction = {
      id: Date.now(),
      type: 'user_transfer',
      from: fromUserId,
      fromName: fromUser.first_name || fromUser.username || 'Unknown',
      to: toUserId,
      toName: toUser.first_name || toUser.username || 'Unknown',
      currency: currency,
      amount: amount,
      message: message,
      timestamp: new Date(),
      status: 'pending',
      transferId: transferId
    };
    transactions.push(transaction);

    console.log('⏳ Transfer initiated:', { 
      transferId, 
      from: fromUser.username, 
      to: toUser.username
    });

    setTimeout(async () => {
      await completeTransfer(transferId);
    }, 30000);

    try {
      await bot.sendMessage(
        fromUserId, 
        `⏳ *Перевод initiated!*\n${amount} ${currency} → @${toUser.username}\n${message ? `💬 "${message}"\n` : ''}\n📊 *Статус:* В обработке\n⏰ *Завершится через:* 30 секунд`
      );
      
      await bot.sendMessage(
        toUserId, 
        `📥 *Входящий перевод!*\n${amount} ${currency} от @${fromUser.username || fromUser.first_name}\n${message ? `💬 "${message}"\n` : ''}\n⏰ *Зачисление через:* 30 секунд`
      );
    } catch (botError) {
      console.log('⚠️ Bot notification failed:', botError.message);
    }

    res.json({ 
      success: true, 
      transferId: transferId,
      status: 'pending',
      message: 'Перевод initiated. Зачисление через 30 секунд.',
      willCompleteAt: pendingTransfers[transferId].willCompleteAt,
      newBalance: fromUser.balance
    });

  } catch (error) {
    console.log('❌ Transfer initiation error:', error);
    res.status(500).json({ error: '❌ Ошибка инициализации перевода: ' + error.message });
  }
});

// Функция завершения перевода
async function completeTransfer(transferId) {
  const transfer = pendingTransfers[transferId];
  
  if (!transfer || transfer.status !== 'pending') return;

  try {
    const fromUser = users[transfer.fromUserId];
    const toUser = users[transfer.toUserId];

    if (!fromUser || !toUser) {
      console.log('❌ Users not found for transfer completion:', transferId);
      transfer.status = 'failed';
      return;
    }

    toUser.balance[transfer.currency] = parseFloat((toUser.balance[transfer.currency] + transfer.amount).toFixed(8));
    fromUser.xp += 10;

    const transaction = transactions.find(t => t.transferId === transferId);
    if (transaction) {
      transaction.status = 'completed';
      transaction.timestamp = new Date();
    }

    transfer.status = 'completed';
    transfer.completedAt = new Date();

    console.log('✅ Transfer completed:', { transferId, from: fromUser.username, to: toUser.username });

    try {
      await bot.sendMessage(
        transfer.fromUserId, 
        `✅ *Перевод completed!*\n${transfer.amount} ${transfer.currency} → @${toUser.username}\n${transfer.message ? `💬 "${transfer.message}"\n` : ''}\n💰 *Ваш баланс:* ${fromUser.balance[transfer.currency]} ${transfer.currency}\n🎉 +10 XP`
      );
      
      await bot.sendMessage(
        transfer.toUserId, 
        `💸 *Перевод received!*\n${transfer.amount} ${transfer.currency} от @${fromUser.username || fromUser.first_name}\n${transfer.message ? `💬 "${transfer.message}"\n` : ''}\n💰 *Текущий баланс:* ${toUser.balance[transfer.currency]} ${transfer.currency}`
      );
    } catch (botError) {
      console.log('⚠️ Bot completion notification failed:', botError.message);
    }

  } catch (error) {
    console.log('❌ Transfer completion error:', error);
    transfer.status = 'failed';
    
    try {
      const fromUser = users[transfer.fromUserId];
      if (fromUser) {
        fromUser.balance[transfer.currency] += transfer.amount;
        await bot.sendMessage(
          transfer.fromUserId, 
          `❌ *Ошибка перевода!*\nСредства возвращены на ваш баланс.\nПричина: ${error.message}`
        );
      }
    } catch (refundError) {
      console.log('❌ Refund error:', refundError);
    }
  }
}

// API для проверки статуса перевода
app.get('/api/transfer/status/:transferId', (req, res) => {
  const transferId = req.params.transferId;
  const transfer = pendingTransfers[transferId];
  
  if (!transfer) {
    return res.status(404).json({ error: '❌ Перевод не найден' });
  }
  
  const timeLeft = Math.max(0, transfer.willCompleteAt - Date.now());
  const secondsLeft = Math.ceil(timeLeft / 1000);
  
  res.json({
    transferId: transfer.id,
    status: transfer.status,
    fromUserId: transfer.fromUserId,
    toUserId: transfer.toUserId,
    currency: transfer.currency,
    amount: transfer.amount,
    message: transfer.message,
    createdAt: transfer.createdAt,
    willCompleteAt: transfer.willCompleteAt,
    timeLeft: timeLeft,
    secondsLeft: secondsLeft,
    completedAt: transfer.completedAt
  });
});

// API для чеков
app.post('/api/checks/create', (req, res) => {
  const { userId, amount, currency, message, password } = req.body;
  
  if (isUserBlocked(userId)) {
    return res.status(403).json({ 
      error: 'USER_BLOCKED',
      message: 'Вы заблокированы и не можете создавать чеки'
    });
  }
  
  console.log('🎫 Check creation:', { userId, amount, currency, message, hasPassword: !!password });
  
  try {
    const user = users[userId];
    if (!user) {
      return res.status(400).json({ error: '❌ Пользователь не найден' });
    }
    
    if (!user.balance[currency] || user.balance[currency] < amount) {
      return res.status(400).json({ error: '❌ Недостаточно средств' });
    }
    
    user.balance[currency] = parseFloat((user.balance[currency] - amount).toFixed(8));
    
    const checkId = generateCheckId();
    checks[checkId] = {
      id: checkId,
      amount: parseFloat(amount),
      currency: currency,
      message: message || '',
      password: password || null,
      creatorId: userId,
      creatorName: user.first_name || user.username || 'Unknown',
      createdAt: new Date(),
      activated: false,
      activatedBy: null,
      activatedAt: null
    };
    
    console.log('✅ Check created:', checkId);
    
    const checkUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'licryptobot.onrender.com'}/check/${checkId}`;
    
    res.json({
      success: true,
      checkId: checkId,
      checkUrl: checkUrl,
      hasPassword: !!password,
      newBalance: user.balance
    });
    
  } catch (error) {
    console.log('❌ Check creation error:', error);
    res.status(500).json({ error: '❌ Ошибка создания чека' });
  }
});

app.post('/api/checks/activate', (req, res) => {
  const { checkId, password } = req.body;
  
  console.log('🎫 Check activation attempt:', { checkId, hasPassword: !!password });
  
  try {
    const check = checks[checkId];
    
    if (!check) {
      return res.status(400).json({ error: '❌ Чек не найден' });
    }
    
    if (check.activated) {
      return res.status(400).json({ error: '❌ Чек уже активирован' });
    }
    
    if (check.password && check.password !== password) {
      return res.status(400).json({ error: '❌ Неверный пароль' });
    }
    
    const activatorId = 'user_' + Date.now();
    
    if (activatorId === check.creatorId) {
      return res.status(400).json({ error: '❌ Создатель чека не может его активировать' });
    }
    
    check.activated = true;
    check.activatedBy = activatorId;
    check.activatedAt = new Date();
    
    console.log('✅ Check activated:', checkId);
    
    res.json({
      success: true,
      amount: check.amount,
      currency: check.currency,
      message: 'Чек успешно активирован'
    });
    
  } catch (error) {
    console.log('❌ Check activation error:', error);
    res.status(500).json({ error: '❌ Ошибка активации чека' });
  }
});

// API для админ действий
app.post('/api/admin/add-crypto', (req, res) => {
  const { adminUserId, targetUsername, currency, amount } = req.body;
  
  try {
    const adminUser = users[adminUserId];
    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: '❌ Доступ запрещен' });
    }
    
    const targetUser = Object.values(users).find(u => 
      u.username && u.username.toLowerCase() === targetUsername.toLowerCase()
    );
    
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Пользователь не найден' });
    }
    
    if (isUserBlocked(targetUser.id)) {
      return res.status(400).json({ error: '❌ Нельзя выдать крипту заблокированному пользователю' });
    }
    
    if (!['BTC', 'ETH', 'USDT', 'LCOIN'].includes(currency)) {
      return res.status(400).json({ error: '❌ Неверная валюта' });
    }
    
    targetUser.balance[currency] = (targetUser.balance[currency] || 0) + parseFloat(amount);
    
    const transaction = {
      id: Date.now(),
      type: 'admin_grant',
      from: 'SYSTEM',
      fromName: 'Система',
      to: targetUser.id,
      toName: targetUser.first_name || targetUser.username,
      currency: currency,
      amount: parseFloat(amount),
      message: `Выдано администратором @${adminUser.username}`,
      timestamp: new Date(),
      status: 'completed'
    };
    transactions.push(transaction);
    
    console.log('✅ Admin added crypto:', {
      admin: adminUser.username,
      target: targetUser.username,
      currency: currency,
      amount: amount,
      newBalance: targetUser.balance[currency]
    });
    
    res.json({
      success: true,
      message: `✅ Выдано ${amount} ${currency} пользователю @${targetUsername}`,
      newBalance: targetUser.balance
    });
    
  } catch (error) {
    console.log('❌ Admin add crypto error:', error);
    res.status(500).json({ error: '❌ Ошибка выдачи криптовалюты' });
  }
});

// API для управления блокировками
app.post('/api/admin/block-user', (req, res) => {
  const { adminUserId, targetUsername, reason } = req.body;
  
  try {
    const adminUser = users[adminUserId];
    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: '❌ Доступ запрещен' });
    }
    
    const targetUser = Object.values(users).find(u => 
      u.username && u.username.toLowerCase() === targetUsername.toLowerCase()
    );
    
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Пользователь не найден' });
    }
    
    if (targetUser.isAdmin) {
      return res.status(400).json({ error: '❌ Нельзя заблокировать администратора' });
    }
    
    if (isUserBlocked(targetUser.id)) {
      return res.status(400).json({ error: '❌ Пользователь уже заблокирован' });
    }
    
    blockUser(targetUser.id, reason, adminUser.id);
    
    const blockMessage = `🚫 *Вы были заблокированы в боте*\n\n📋 *Причина:* ${reason}\n⏰ *Дата блокировки:* ${new Date().toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${adminUser.username}\n\n💡 *Для разблокировки обратитесь к администратору*`;
    bot.sendMessage(targetUser.id, blockMessage, { parse_mode: 'Markdown' });
    
    res.json({
      success: true,
      message: `✅ Пользователь @${targetUsername} заблокирован`
    });
    
  } catch (error) {
    console.log('❌ Admin block user error:', error);
    res.status(500).json({ error: '❌ Ошибка блокировки пользователя' });
  }
});

app.post('/api/admin/unblock-user', (req, res) => {
  const { adminUserId, targetUsername } = req.body;
  
  try {
    const adminUser = users[adminUserId];
    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: '❌ Доступ запрещен' });
    }
    
    const targetUser = Object.values(users).find(u => 
      u.username && u.username.toLowerCase() === targetUsername.toLowerCase()
    );
    
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Пользователь не найден' });
    }
    
    if (!isUserBlocked(targetUser.id)) {
      return res.status(400).json({ error: '❌ Пользователь не заблокирован' });
    }
    
    const success = unblockUser(targetUser.id, adminUser.id);
    
    if (success) {
      const unblockMessage = `🎉 *Вы были разблокированы в боте!*\n\n✅ Теперь вы снова можете пользоваться всеми функциями бота.\n👮 *Разблокировал:* @${adminUser.username}\n\n💡 Добро пожаловать обратно!`;
      bot.sendMessage(targetUser.id, unblockMessage, { parse_mode: 'Markdown' });
      
      res.json({
        success: true,
        message: `✅ Пользователь @${targetUsername} разблокирован`
      });
    } else {
      res.status(500).json({ error: '❌ Ошибка при разблокировке' });
    }
    
  } catch (error) {
    console.log('❌ Admin unblock user error:', error);
    res.status(500).json({ error: '❌ Ошибка разблокировки пользователя' });
  }
});

// API для получения списка заблокированных пользователей
app.get('/api/admin/blocked-users', (req, res) => {
  const { adminUserId } = req.query;
  
  try {
    const adminUser = users[adminUserId];
    if (!adminUser || !adminUser.isAdmin) {
      return res.status(403).json({ error: '❌ Доступ запрещен' });
    }
    
    const blockedList = Object.entries(blockedUsers)
      .filter(([userId, info]) => info.isBlocked)
      .map(([userId, info]) => {
        const user = users[userId];
        return {
          userId: userId,
          username: user?.username || 'unknown',
          firstName: user?.first_name || 'Unknown',
          reason: info.reason,
          blockedBy: users[info.blockedBy]?.username || 'admin',
          blockedAt: info.blockedAt
        };
      });
    
    res.json({
      success: true,
      blockedUsers: blockedList
    });
    
  } catch (error) {
    console.log('❌ Get blocked users error:', error);
    res.status(500).json({ error: '❌ Ошибка получения списка заблокированных' });
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
    blockedUsers: Object.values(blockedUsers).filter(u => u.isBlocked).length,
    checks: Object.keys(checks).length,
    pendingTransfers: Object.keys(pendingTransfers).length,
    transactions: transactions.length,
    admin: ADMIN_USERNAME
  });
});

// Обработка ошибок бота
bot.on('error', (error) => {
  console.log('Bot error:', error);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LiCrypto Server running on port ${PORT}`);
  console.log(`📁 Static files from: ${path.join(__dirname, 'public')}`);
  console.log(`🤖 Bot token: ${TOKEN ? 'SET' : 'MISSING'}`);
  console.log(`⚡ Admin user: @${ADMIN_USERNAME}`);
});
