const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');

// ห้องทิกเก็ตต้องขึ้นต้นด้วยคำนี้ (ปรับได้ผ่าน .env ถ้าระบบทิกเก็ตของคุณตั้งชื่อห้องแบบอื่น)
const TICKET_CHANNEL_PREFIX = process.env.TICKET_NOTIFY_CHANNEL_PREFIX || 'ticket-';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// เก็บว่าห้องไหนแจ้งเตือนไปแล้วบ้าง กันส่งซ้ำ (ส่งแค่ข้อความแรกของแต่ละทิกเก็ตเท่านั้น)
const notifiedChannels = new Set();

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('⚠️ [แจ้งเตือน Telegram] ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('❌ [แจ้งเตือน Telegram] ส่งข้อความไม่สำเร็จ:', res.status, errText);
  }
}

// ตัวช่วยกัน HTML injection ในข้อความลูกค้า (Telegram ใช้ parse_mode: HTML)
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const DIVIDER = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
const BRAND_FOOTER = '✦ JRTWCX ✦';

function formatThaiTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

function startTelegramNotifyBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once('ready', () => {
    console.log(`📨 [แจ้งเตือน Telegram] ล็อกอินสำเร็จในชื่อ ${client.user.tag}`);
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.warn('⚠️ [แจ้งเตือน Telegram] ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — จะล็อกอินได้แต่ส่งแจ้งเตือนไม่ได้');
    }
  });

  client.on('channelCreate', async (channel) => {
    try {
      if (channel.type !== ChannelType.GuildText) return;
      if (!channel.name?.startsWith(TICKET_CHANNEL_PREFIX)) return;

      const channelLink = `https://discord.com/channels/${channel.guild.id}/${channel.id}`;
      const text =
        `🆕✨ <b>มีทิกเก็ตใหม่เข้ามาแล้ว!</b> ✨🆕\n` +
        `${DIVIDER}\n` +
        `📌 <b>ห้อง</b>  ·  <code>#${escapeHtml(channel.name)}</code>\n` +
        `🕒 <b>เวลา</b>  ·  <code>${formatThaiTime()}</code>\n` +
        `${DIVIDER}\n` +
        `🔗 <a href="${channelLink}">👉 กดเข้าไปดูเลย</a>\n\n` +
        `<i>${BRAND_FOOTER}</i>`;

      await sendTelegramMessage(text);
    } catch (err) {
      console.error('❌ [แจ้งเตือน Telegram] เกิดข้อผิดพลาดใน channelCreate:', err);
    }
  });

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!message.channel.name?.startsWith(TICKET_CHANNEL_PREFIX)) return;

      // ส่งแค่ข้อความแรกของแต่ละทิกเก็ตเท่านั้น กันสแปม Telegram ถ้าคุยกันยาว
      if (notifiedChannels.has(message.channel.id)) return;
      notifiedChannels.add(message.channel.id);

      const channelLink = `https://discord.com/channels/${message.guild.id}/${message.channel.id}`;
      const content = message.content?.trim() || '(ไม่มีข้อความ อาจแนบไฟล์/รูปอย่างเดียว)';

      const text =
        `💬✨ <b>ลูกค้าทักมาในทิกเก็ตแล้ว!</b> ✨💬\n` +
        `${DIVIDER}\n` +
        `👤 <b>ผู้ส่ง</b>  ·  ${escapeHtml(message.author.tag)}\n` +
        `📌 <b>ห้อง</b>  ·  <code>#${escapeHtml(message.channel.name)}</code>\n` +
        `🕒 <b>เวลา</b>  ·  <code>${formatThaiTime()}</code>\n\n` +
        `<blockquote>📝 ${escapeHtml(content)}</blockquote>\n` +
        `${DIVIDER}\n` +
        `🔗 <a href="${channelLink}">👉 กดเข้าไปตอบลูกค้าเลย</a>\n\n` +
        `<i>${BRAND_FOOTER}</i>`;

      await sendTelegramMessage(text);
    } catch (err) {
      console.error('❌ [แจ้งเตือน Telegram] เกิดข้อผิดพลาดใน messageCreate:', err);
    }
  });

  // กันหน่วยความจำบวมถ้าห้องทิกเก็ตถูกลบไปแล้ว เอา id ที่ไม่มีห้องจริงออกเป็นระยะ
  client.on('channelDelete', (channel) => {
    notifiedChannels.delete(channel.id);
  });

  if (!process.env.TICKET_NOTIFY_DISCORD_TOKEN) {
    console.warn('⚠️ [แจ้งเตือน Telegram] ไม่พบ TICKET_NOTIFY_DISCORD_TOKEN ใน .env — บอทแจ้งเตือนจะไม่ทำงาน');
    return client;
  }

  client.login(process.env.TICKET_NOTIFY_DISCORD_TOKEN).catch((err) => {
    console.error('❌ [แจ้งเตือน Telegram] ล็อกอินไม่สำเร็จ (เช็ค TICKET_NOTIFY_DISCORD_TOKEN):', err.message);
  });
  return client;
}

module.exports = { startTelegramNotifyBot };
