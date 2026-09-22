require('dotenv').config();
const express = require('express');
const { startReviewBot } = require('./bots/review-bot');
const { startPaymentBot } = require('./bots/payment-bot');
const { startStatusBot } = require('./bots/status-bot');
const { startAiChatBot } = require('./bots/ai-chat-bot');
// const { startAntispamBot } = require('./bots/antispam-bot'); // ปิดใช้งานชั่วคราว
const { startAdsBot } = require('./bots/ads-bot');
const { startTelegramNotifyBot } = require('./bots/telegram-notify-bot');

// ---------- Keep-alive web server เดียว ใช้ร่วมกันทั้ง 2 บอท ----------
const app = express();
app.get('/', (req, res) => res.send('Review bot + Payment bot are running ✅'));
app.listen(process.env.PORT || 8080, () => {
  console.log(`🌐 Keep-alive server listening on port ${process.env.PORT || 8080}`);
});

startReviewBot();
startPaymentBot();
startStatusBot();
startAiChatBot();
// startAntispamBot(); // ปิดใช้งานชั่วคราว
startAdsBot();
startTelegramNotifyBot();
