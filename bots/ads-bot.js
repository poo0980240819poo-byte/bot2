const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// ----------------------------------------------------------------------
// ⚙️ ตั้งค่าผ่าน .env
// ----------------------------------------------------------------------
// ห้องที่จะโพสต์ประกาศ "มีสินค้าใหม่/อัปเดตสินค้า"
const ANNOUNCE_CHANNEL_ID = process.env.ADS_ANNOUNCE_CHANNEL_ID;

// ห้องสินค้าที่ต้องจับตาดู (คั่นด้วยจุลภาค) — เวลามีคนโพสต์ในห้องพวกนี้จะไปประกาศให้
const WATCH_CHANNEL_IDS = new Set(
  (process.env.ADS_WATCH_CHANNEL_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
);

// หมวดหมู่ (category) ที่จะจับตาดูทั้งหมวด (คั่นด้วยจุลภาค) — สะดวกกว่าถ้ามีหลายห้องสินค้าในหมวดเดียวกัน
// เช่น หมวด "WINDOW OS", "WINDOWS PLAYBOOK", "FIVEM" ตามที่ร้านนี้จัดไว้
const WATCH_CATEGORY_IDS = new Set(
  (process.env.ADS_WATCH_CATEGORY_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
);

// ยศที่จะแท็กตอนประกาศ (ไม่ใส่ก็ได้ ไม่แท็กใครเลย)
const MENTION_ROLE_ID = process.env.ADS_MENTION_ROLE_ID;

// กันประกาศซ้ำถี่เกินไปถ้าแอดมินโพสต์หลายข้อความรัวๆ ในห้องเดียวกัน (มิลลิวินาที)
const PER_CHANNEL_COOLDOWN_MS = Number(process.env.ADS_COOLDOWN_MS) || 60 * 1000;

// ทุกกี่มิลลิวินาที ให้เตือนซ้ำเรื่องสินค้าที่มีอยู่แล้วทั้งหมด (ค่าเริ่มต้น 5 ชั่วโมง)
const REMINDER_INTERVAL_MS = Number(process.env.ADS_REMINDER_INTERVAL_MS) || 5 * 60 * 60 * 1000;

const GUILD_ID = process.env.GUILD_ID;

const COLOR_ANNOUNCE = 0xeb459e; // ชมพูสด เด่นสะดุดตา

function startAdsBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  const lastAnnouncedAt = new Map(); // channelId -> timestamp กันประกาศซ้ำถี่

  client.once('ready', () => {
    console.log(`📢 [โฆษณา] ล็อกอินสำเร็จในชื่อ ${client.user.tag}`);
    if (!ANNOUNCE_CHANNEL_ID) {
      console.warn('⚠️ [โฆษณา] ยังไม่ได้ตั้งค่า ADS_ANNOUNCE_CHANNEL_ID');
    }
    if (WATCH_CHANNEL_IDS.size === 0 && WATCH_CATEGORY_IDS.size === 0) {
      console.warn('⚠️ [โฆษณา] ยังไม่ได้ตั้งค่าห้อง/หมวดที่จะจับตาดูเลย (ADS_WATCH_CHANNEL_IDS หรือ ADS_WATCH_CATEGORY_IDS)');
    }
    if (!GUILD_ID) {
      console.warn('⚠️ [โฆษณา] ยังไม่ได้ตั้งค่า GUILD_ID — ระบบเตือนซ้ำทุก 5 ชม. จะทำงานไม่ได้');
    } else {
      console.log(`🔁 [โฆษณา] ตั้งเตือนสินค้าซ้ำทุก ${Math.round(REMINDER_INTERVAL_MS / 3600000)} ชั่วโมง`);
      setInterval(sendProductReminder, REMINDER_INTERVAL_MS);
    }
  });

  function isWatchedChannel(channel) {
    if (WATCH_CHANNEL_IDS.has(channel.id)) return true;
    if (channel.parentId && WATCH_CATEGORY_IDS.has(channel.parentId)) return true;
    return false;
  }

  // ----------------------------------------------------------------------
  // 🔁 เตือนซ้ำทุก REMINDER_INTERVAL_MS — รวบรวมห้องสินค้าที่มีอยู่ทั้งหมด (ทั้งเก่า/ใหม่)
  // แล้วส่งเป็นลิสต์เตือนความจำไปห้องประกาศ กันลูกค้าลืมว่ามีสินค้าอะไรขายอยู่บ้าง
  // ----------------------------------------------------------------------
  async function sendProductReminder() {
    try {
      if (!ANNOUNCE_CHANNEL_ID || !GUILD_ID) return;

      const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
      if (!guild) {
        console.warn('[โฆษณา] ไม่พบเซิร์ฟเวอร์ กรุณาตรวจสอบค่า GUILD_ID');
        return;
      }

      const announceChannel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (!announceChannel) return;

      const allChannels = await guild.channels.fetch();

      // จัดกลุ่มห้องสินค้าตามหมวดหมู่ ให้อ่านง่าย
      const groups = new Map(); // categoryName -> [channelMention, ...]
      const ungrouped = [];

      for (const channel of allChannels.values()) {
        if (!channel || channel.type !== 0) continue; // เฉพาะห้องข้อความ (GuildText = 0)
        if (!isWatchedChannel(channel)) continue;

        if (channel.parentId && WATCH_CATEGORY_IDS.has(channel.parentId)) {
          const category = allChannels.get(channel.parentId);
          const groupName = category?.name ?? 'สินค้า';
          if (!groups.has(groupName)) groups.set(groupName, []);
          groups.get(groupName).push(`<#${channel.id}>`);
        } else {
          ungrouped.push(`<#${channel.id}>`);
        }
      }

      if (groups.size === 0 && ungrouped.length === 0) return; // ไม่มีห้องสินค้าให้เตือนเลย

      let listText = '';
      for (const [groupName, mentions] of groups) {
        listText += `\n**📁 ${groupName}**\n${mentions.join('  ')}\n`;
      }
      if (ungrouped.length > 0) {
        listText += `\n**📁 อื่นๆ**\n${ungrouped.join('  ')}\n`;
      }

      const embed = new EmbedBuilder()
        .setColor(COLOR_ANNOUNCE)
        .setAuthor({ name: '🔁 เตือนความจำ: สินค้าที่มีตอนนี้', iconURL: client.user.displayAvatarURL() })
        .setDescription(listText.trim())
        .setFooter({ text: 'ระบบแจ้งเตือนสินค้าใหม่ · เตือนซ้ำอัตโนมัติ' })
        .setTimestamp();

      await announceChannel.send({
        content: MENTION_ROLE_ID ? `<@&${MENTION_ROLE_ID}>` : undefined,
        embeds: [embed],
        allowedMentions: MENTION_ROLE_ID ? { roles: [MENTION_ROLE_ID] } : undefined,
      });
    } catch (err) {
      console.error('❌ [โฆษณา] เกิดข้อผิดพลาดตอนเตือนซ้ำ:', err);
    }
  }

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!ANNOUNCE_CHANNEL_ID) return;
      if (!isWatchedChannel(message.channel)) return;

      // เฉพาะแอดมิน/ผู้มีสิทธิ์ Manage Server เท่านั้นที่โพสต์แล้วจะทริกเกอร์ประกาศ
      // (กันลูกค้าคอมเมนต์ในห้องสินค้าแล้วดันไปประกาศเป็นสินค้าใหม่)
      if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return;

      // ข้อความเปล่าไม่มีเนื้อหา/ไฟล์แนบ ไม่ต้องประกาศ
      if (!message.content?.trim() && message.attachments.size === 0) return;

      // กันประกาศซ้ำถี่เกินไปถ้าแอดมินโพสต์หลายข้อความรัวๆ ในห้องเดียวกัน
      const now = Date.now();
      const last = lastAnnouncedAt.get(message.channel.id) ?? 0;
      if (now - last < PER_CHANNEL_COOLDOWN_MS) return;
      lastAnnouncedAt.set(message.channel.id, now);

      const announceChannel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (!announceChannel) {
        console.warn('[โฆษณา] ไม่พบห้องประกาศ กรุณาตรวจสอบค่า ADS_ANNOUNCE_CHANNEL_ID');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(COLOR_ANNOUNCE)
        .setAuthor({ name: '📢 มีสินค้าใหม่ / อัปเดตสินค้า!', iconURL: client.user.displayAvatarURL() })
        .setDescription(
          `🛍️ เข้าไปดูกันเลยที่ <#${message.channel.id}>\n\n` +
          (message.content?.trim() ? `💬 ${message.content.trim()}` : ''),
        )
        .setFooter({ text: 'ระบบแจ้งเตือนสินค้าใหม่' })
        .setTimestamp();

      const files = [];
      const firstImage = message.attachments.find((a) => a.contentType?.startsWith('image/'));
      if (firstImage) {
        // ดาวน์โหลดรูปมาอัปโหลดใหม่เอง กันลิงก์ CDN หมดอายุทีหลัง (เหมือนที่แก้ไว้ในบอทโอนเงิน)
        try {
          const res = await fetch(firstImage.url);
          const buffer = Buffer.from(await res.arrayBuffer());
          const ext = (firstImage.name?.split('.').pop() || 'png').toLowerCase();
          const fileName = `product.${ext}`;
          files.push({ attachment: buffer, name: fileName });
          embed.setImage(`attachment://${fileName}`);
        } catch (err) {
          console.error('[โฆษณา] ดาวน์โหลดรูปสินค้าไม่สำเร็จ:', err.message);
        }
      }

      await announceChannel.send({
        content: MENTION_ROLE_ID ? `<@&${MENTION_ROLE_ID}>` : undefined,
        embeds: [embed],
        files,
        allowedMentions: MENTION_ROLE_ID ? { roles: [MENTION_ROLE_ID] } : undefined,
      });
    } catch (err) {
      console.error('❌ [โฆษณา] เกิดข้อผิดพลาดใน messageCreate:', err);
    }
  });

  if (!process.env.ADS_DISCORD_TOKEN) {
    console.warn('⚠️ [โฆษณา] ไม่พบ ADS_DISCORD_TOKEN ใน .env — บอทโฆษณาจะไม่ทำงาน');
    return client;
  }

  client.login(process.env.ADS_DISCORD_TOKEN).catch((err) => {
    console.error('❌ [โฆษณา] ล็อกอินไม่สำเร็จ (เช็ค ADS_DISCORD_TOKEN):', err.message);
  });
  return client;
}

module.exports = { startAdsBot };

