const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '7965716660:AAHExQooYGa2zT_bueGmKxnri9GDOaAeKXE';
const ADMIN_USERNAME = 'ScarletID'; // Администратор системы

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
let blockedUsers = {}; // Система блокировок

// Инициализация пользователя
function initUser(userId, userData) {
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      balance: {
        BTC: 0,
        ETH: 0,
        USDT: 1, // Только 1 USDT при старте
        SOL: 0,
        LCOIN: 0
      },
      username: userData?.username || '',
      first_name: userData?.first_name || '',
      level: 1,
      xp: 0,
      lastTransfer: null,
      isAdmin: userData?.username === ADMIN_USERNAME // Проверка на админа
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
    blockedUntil: null // null означает перманентная блокировка
  };
  
  console.log(`🔒 User ${userId} blocked by ${adminId}. Reason: ${reason}`);
}

// Разблокировка пользователя
function unblockUser(userId, adminId) {
  if (blockedUsers[userId]) {
    const userInfo = blockedUsers[userId];
    blockedUsers[userId] = {
      ...userInfo,
      isBlocked: false,
      unblockedBy: adminId,
      unblockedAt: new Date()
    };
    
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
    const blockMessage = `🚫 *Вы заблокированы в боте*\n\n📋 *Причина:* ${blockInfo.reason}\n⏰ *Дата блокировки:* ${new Date(blockInfo.blockedAt).toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${users[blockInfo.blockedBy]?.username || 'администратор'}\n\n💡 *Для разблокировки обратитесь к администратору*`;
    
    bot.sendMessage(userId, blockMessage, { parse_mode: 'Markdown' });
    return true;
  }
  return false;
}

// Команды бота
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  // Проверка блокировки
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
  
  // Проверка блокировки
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
/addcrypto - Выдать криптовалюту
/block - Заблокировать пользователя
/unblock - Разблокировать пользователя
/stats - Статистика системы
/users - Список пользователей
  `;
  
  bot.sendMessage(chatId, adminMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Выдать крипту', callback_data: 'add_crypto' }],
        [{ text: '🔒 Блокировки', callback_data: 'block_management' }],
        [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
        [{ text: '👥 Пользователи', callback_data: 'admin_users' }]
      ]
    }
  });
});

// Блокировка пользователя
bot.onText(/\/block (@\w+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  // Проверка блокировки
  if (checkBlockStatus(msg)) return;
  
  const adminUser = initUser(chatId, msg.from);
  
  if (!adminUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const targetUsername = match[1].replace('@', '');
  const reason = match[2];
  
  // Находим пользователя
  const targetUser = Object.values(users).find(u => u.username === targetUsername);
  
  if (!targetUser) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не найден.`);
  }
  
  if (targetUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ Нельзя заблокировать администратора!');
  }
  
  if (isUserBlocked(targetUser.id)) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} уже заблокирован.`);
  }
  
  // Блокируем пользователя
  blockUser(targetUser.id, reason, adminUser.id);
  
  // Уведомляем администратора
  bot.sendMessage(chatId, `🔒 Пользователь @${targetUsername} заблокирован.\n📋 Причина: ${reason}`);
  
  // Уведомляем заблокированного пользователя
  const blockMessage = `🚫 *Вы были заблокированы в боте*\n\n📋 *Причина:* ${reason}\n⏰ *Дата блокировки:* ${new Date().toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${adminUser.username}\n\n💡 *Для разблокировки обратитесь к администратору*`;
  bot.sendMessage(targetUser.id, blockMessage, { parse_mode: 'Markdown' });
});

// Разблокировка пользователя
bot.onText(/\/unblock (@\w+)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  // Проверка блокировки
  if (checkBlockStatus(msg)) return;
  
  const adminUser = initUser(chatId, msg.from);
  
  if (!adminUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const targetUsername = match[1].replace('@', '');
  
  // Находим пользователя
  const targetUser = Object.values(users).find(u => u.username === targetUsername);
  
  if (!targetUser) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не найден.`);
  }
  
  if (!isUserBlocked(targetUser.id)) {
    return bot.sendMessage(chatId, `❌ Пользователь @${targetUsername} не заблокирован.`);
  }
  
  // Разблокируем пользователя
  const success = unblockUser(targetUser.id, adminUser.id);
  
  if (success) {
    // Уведомляем администратора
    bot.sendMessage(chatId, `🔓 Пользователь @${targetUsername} разблокирован.`);
    
    // Уведомляем разблокированного пользователя
    const unblockMessage = `🎉 *Вы были разблокированы в боте!*\n\n✅ Теперь вы снова можете пользоваться всеми функциями бота.\n👮 *Разблокировал:* @${adminUser.username}\n\n💡 Добро пожаловать обратно!`;
    bot.sendMessage(targetUser.id, unblockMessage, { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(chatId, `❌ Ошибка при разблокировке пользователя @${targetUsername}`);
  }
});

// Выдача криптовалюты админом
bot.onText(/\/addcrypto/, (msg) => {
  const chatId = msg.chat.id;
  
  // Проверка блокировки
  if (checkBlockStatus(msg)) return;
  
  const user = initUser(chatId, msg.from);
  
  if (!user.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  bot.sendMessage(chatId, '💎 *Выдача криптовалюты*\n\nВведите команду в формате:\n`/add @username BTC 0.1`\n\nДоступные валюты: BTC, ETH, USDT, LCOIN', {
    parse_mode: 'Markdown'
  });
});

// Обработка выдачи крипты
bot.onText(/\/add (@\w+) (\w+) (\d+\.?\d*)/, (msg, match) => {
  const chatId = msg.chat.id;
  
  // Проверка блокировки
  if (checkBlockStatus(msg)) return;
  
  const adminUser = initUser(chatId, msg.from);
  
  if (!adminUser.isAdmin) {
    return bot.sendMessage(chatId, '❌ *Доступ запрещен!*', { parse_mode: 'Markdown' });
  }
  
  const targetUsername = match[1].replace('@', '');
  const currency = match[2].toUpperCase();
  const amount = parseFloat(match[3]);
  
  // Проверяем блокировку целевого пользователя
  const targetUser = Object.values(users).find(u => u.username === targetUsername);
  
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
  targetUser.balance[currency] += amount;
  
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
  bot.sendMessage(chatId, `✅ Выдано ${amount} ${currency} пользователю @${targetUsername}`);
  bot.sendMessage(targetUser.id, `🎉 Администратор выдал вам ${amount} ${currency}!`);
});

bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  
  // Проверка блокировки
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
  
  // Проверка блокировки
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
  
  // Проверка блокировки
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
  
  // Проверка блокировки для callback
  if (isUserBlocked(chatId)) {
    const blockInfo = getBlockInfo(chatId);
    const blockMessage = `🚫 *Вы заблокированы в боте*\n\n📋 *Причина:* ${blockInfo.reason}\n⏰ *Дата блокировки:* ${new Date(blockInfo.blockedAt).toLocaleDateString('ru-RU')}\n👮 *Заблокировал:* @${users[blockInfo.blockedBy]?.username || 'администратор'}\n\n💡 *Для разблокировки обратитесь к администратору*`;
    
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
  else if (data === 'add_crypto' && user.isAdmin) {
    bot.sendMessage(chatId, '💎 *Выдача криптовалюты*\n\nВведите команду в формате:\n`/add @username BTC 0.1`\n\nДоступные валюты: BTC, ETH, USDT, LCOIN', {
      parse_mode: 'Markdown'
    });
  }
  else if (data === 'block_management' && user.isAdmin) {
    const blockedUsersList = Object.entries(blockedUsers)
      .filter(([userId, info]) => info.isBlocked)
      .slice(0, 10);
    
    let blockMessage = '🔒 *Заблокированные пользователи:*\n\n';
    
    if (blockedUsersList.length === 0) {
      blockMessage += 'Нет заблокированных пользователей.';
    } else {
      blockedUsersList.forEach(([userId, info], index) => {
        const blockedUser = users[userId];
        const username = blockedUser ? `@${blockedUser.username}` : `ID: ${userId}`;
        blockMessage += `${index + 1}. ${username}\n`;
        blockMessage += `   📋 ${info.reason}\n`;
        blockMessage += `   ⏰ ${new Date(info.blockedAt).toLocaleDateString('ru-RU')}\n\n`;
      });
      
      blockMessage += '\n💡 Используйте `/unblock @username` для разблокировки';
    }
    
    bot.sendMessage(chatId, blockMessage, { parse_mode: 'Markdown' });
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
  
  // Проверка блокировки для API
  if (isUserBlocked(userId)) {
    return res.status(403).json({ 
      error: 'USER_BLOCKED',
      message: 'Пользователь заблокирован',
      blockInfo: getBlockInfo(userId)
    });
  }
  
  const user = initUser(userId);
  const userWallets = wallets[userId] || [];
  
  // Получаем историю операций пользователя
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

  // Проверка блокировки отправителя
  if (isUserBlocked(fromUserId)) {
    return res.status(403).json({ 
      error: 'USER_BLOCKED',
      message: 'Вы заблокированы и не можете совершать переводы',
      blockInfo: getBlockInfo(fromUserId)
    });
  }

  console.log('🔧 Transfer initiation:', { fromUserId, toUsername, currency, amount, message });

  try {
    const cleanUsername = toUsername.replace('@', '').trim();
    const toUserEntry = Object.entries(users).find(([userId, user]) => 
      user.username && user.username.toLowerCase() === cleanUsername.toLowerCase()
    );

    if (!toUserEntry) {
      return res.status(400).json({ error: '👤 Пользователь не найден' });
    }

    const [toUserId, toUser] = toUserEntry;
    
    // Проверка блокировки получателя
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

    // Создаем отложенный перевод
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

    // Сразу списываем средства у отправителя
    fromUser.balance[currency] = parseFloat((fromUser.balance[currency] - amount).toFixed(8));

    // Записываем транзакцию как ожидающую
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

    console.log('⏳ Transfer initiated:', { transferId, from: fromUser.username, to: toUser.username });

    // Запускаем таймер для завершения перевода через 30 секунд
    setTimeout(async () => {
      await completeTransfer(transferId);
    }, 30000);

    // Уведомляем пользователей
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

    // Зачисляем средства получателю
    toUser.balance[transfer.currency] = parseFloat((toUser.balance[transfer.currency] + transfer.amount).toFixed(8));
    fromUser.xp += 10;

    // Обновляем транзакцию
    const transaction = transactions.find(t => t.transferId === transferId);
    if (transaction) {
      transaction.status = 'completed';
      transaction.timestamp = new Date();
    }

    // Обновляем статус перевода
    transfer.status = 'completed';
    transfer.completedAt = new Date();

    console.log('✅ Transfer completed:', { transferId, from: fromUser.username, to: toUser.username });

    // Уведомляем пользователей о завершении
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
    
    // Возвращаем средства отправителю в случае ошибки
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
  
  // Проверка блокировки
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
    
    // Списываем средства
    user.balance[currency] = parseFloat((user.balance[currency] - amount).toFixed(8));
    
    // Создаем чек
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
    
    // Проверяем пароль, если он установлен
    if (check.password && check.password !== password) {
      return res.status(400).json({ error: '❌ Неверный пароль' });
    }
    
    // Здесь обычно получаем ID пользователя из сессии или токена
    const activatorId = 'user_' + Date.now();
    
    // Проверяем, что активатор не создатель чека
    if (activatorId === check.creatorId) {
      return res.status(400).json({ error: '❌ Создатель чека не может его активировать' });
    }
    
    // Активируем чек
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
    
    const targetUser = Object.values(users).find(u => u.username === targetUsername);
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Пользователь не найден' });
    }
    
    // Проверяем блокировку целевого пользователя
    if (isUserBlocked(targetUser.id)) {
      return res.status(400).json({ error: '❌ Нельзя выдать крипту заблокированному пользователю' });
    }
    
    if (!['BTC', 'ETH', 'USDT', 'LCOIN'].includes(currency)) {
      return res.status(400).json({ error: '❌ Неверная валюта' });
    }
    
    // Выдаем крипту
    targetUser.balance[currency] += amount;
    
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
    
    const targetUser = Object.values(users).find(u => u.username === targetUsername);
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Пользователь не найден' });
    }
    
    if (targetUser.isAdmin) {
      return res.status(400).json({ error: '❌ Нельзя заблокировать администратора' });
    }
    
    if (isUserBlocked(targetUser.id)) {
      return res.status(400).json({ error: '❌ Пользователь уже заблокирован' });
    }
    
    // Блокируем пользователя
    blockUser(targetUser.id, reason, adminUser.id);
    
    // Уведомляем заблокированного пользователя
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
    
    const targetUser = Object.values(users).find(u => u.username === targetUsername);
    if (!targetUser) {
      return res.status(404).json({ error: '❌ Пользователь не найден' });
    }
    
    if (!isUserBlocked(targetUser.id)) {
      return res.status(400).json({ error: '❌ Пользователь не заблокирован' });
    }
    
    // Разблокируем пользователя
    const success = unblockUser(targetUser.id, adminUser.id);
    
    if (success) {
      // Уведомляем разблокированного пользователя
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
