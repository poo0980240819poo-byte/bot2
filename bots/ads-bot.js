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

// เว้นจังหวะระหว่างการ์ดโฆษณาแต่ละใบตอนไล่โพสต์ทีละสินค้า (มิลลิวินาที) กันดูเป็นสแปม
const PER_PRODUCT_DELAY_MS = Number(process.env.ADS_PER_PRODUCT_DELAY_MS) || 3000;

const GUILD_ID = process.env.GUILD_ID;

const COLOR_ANNOUNCE = 0xeb459e; // ชมพูสด เด่นสะดุดตา — ใช้กับประกาศ "มีสินค้าใหม่" และหัวข้อสรุป

// สีวนสำหรับการ์ดโฆษณาแต่ละสินค้า ให้แต่ละใบดูมีชีวิตชีวาไม่จำเจ
const COLOR_PALETTE = [0xeb459e, 0x57f287, 0x5865f2, 0xfee75c, 0xed4245, 0xeb8e34, 0x1abc9c];

function pickColor(i) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ส่งแท็กยศเป็นข้อความแยกต่างหาก "หลัง" การ์ดโฆษณา เพื่อให้แท็กไปโผล่อยู่บรรทัดล่างสุด
// (Discord ไม่รองรับ content ใต้ embed ในข้อความเดียวกัน เลยต้องแยกส่ง)
async function sendMentionBelow(channel) {
  if (!MENTION_ROLE_ID) return;
  try {
    await channel.send({
      content: `<@&${MENTION_ROLE_ID}>`,
      allowedMentions: { roles: [MENTION_ROLE_ID] },
    });
  } catch (err) {
    console.error('[โฆษณา] ส่งแท็กยศไม่สำเร็จ:', err.message);
  }
}

// ดาวน์โหลดรูปมาแนบไฟล์ใหม่เอง กันลิงก์ CDN ของ Discord หมดอายุทีหลัง
async function downloadAsAttachment(url, baseName) {
  try {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = (url.split('?')[0].split('.').pop() || 'png').toLowerCase();
    const fileName = `${baseName}.${ext}`;
    return { attachment: buffer, name: fileName };
  } catch (err) {
    console.error('[โฆษณา] ดาวน์โหลดรูปไม่สำเร็จ:', err.message);
    return null;
  }
}

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
  let isSendingReminder = false; // กันไม่ให้ไล่โพสต์สินค้าซ้อนกันถ้ารอบก่อนยังไม่จบ

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
  // 🔍 ไปอ่านห้องสินค้าแต่ละห้อง ดึงคำอธิบาย (สรรพคุณ) + รูปสินค้ามาให้
  // ลำดับการหา: ข้อความที่ปักหมุดไว้ก่อน (ปกติแอดมินจะปักคำโปรยสินค้าไว้)
  // ถ้าไม่มีปักหมุด ก็ไล่หาข้อความล่าสุดที่มีเนื้อหา/รูปแทน
  // ----------------------------------------------------------------------
  async function fetchProductInfo(channel) {
    try {
      const pinned = await channel.messages.fetchPinned().catch(() => null);
      let source = pinned && pinned.size > 0 ? pinned.first() : null;

      if (!source) {
        const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        source = recent?.find((m) => !m.author.bot && (m.content?.trim() || m.attachments.size > 0)) || null;
      }

      if (!source) return { text: '', file: null };

      let imageUrl = null;
      const attachedImage = source.attachments.find((a) => a.contentType?.startsWith('image/'));
      if (attachedImage) imageUrl = attachedImage.url;
      else if (source.embeds?.[0]?.image?.url) imageUrl = source.embeds[0].image.url;
      else if (source.embeds?.[0]?.thumbnail?.url) imageUrl = source.embeds[0].thumbnail.url;

      const file = imageUrl ? await downloadAsAttachment(imageUrl, `product-${channel.id}`) : null;

      return { text: source.content?.trim() || '', file };
    } catch (err) {
      console.error(`[โฆษณา] ดึงข้อมูลห้อง #${channel.name} ไม่สำเร็จ:`, err.message);
      return { text: '', file: null };
    }
  }

  // ----------------------------------------------------------------------
  // 🔁 เตือนซ้ำทุก REMINDER_INTERVAL_MS — ไล่โพสต์การ์ดโฆษณาทีละสินค้า
  // ดึงรูป + คำอธิบายจากห้องสินค้าจริงมาทำเป็นการ์ดสวยๆ ให้เอง
  // ----------------------------------------------------------------------
  async function sendProductReminder() {
    if (isSendingReminder) return;
    isSendingReminder = true;
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

      const products = [];
      for (const channel of allChannels.values()) {
        if (!channel || channel.type !== 0) continue; // เฉพาะห้องข้อความ (GuildText = 0)
        if (!isWatchedChannel(channel)) continue;
        const categoryName = channel.parentId
          ? (allChannels.get(channel.parentId)?.name ?? 'สินค้า')
          : 'สินค้า';
        products.push({ channel, categoryName });
      }

      if (products.length === 0) return; // ไม่มีห้องสินค้าให้เตือนเลย

      const introEmbed = new EmbedBuilder()
        .setColor(COLOR_ANNOUNCE)
        .setAuthor({ name: '🔁 เตือนความจำ: รวมสินค้าทั้งหมดที่มีตอนนี้', iconURL: client.user.displayAvatarURL() })
        .setThumbnail(guild.iconURL() || null)
        .setDescription(`มีสินค้าทั้งหมด **${products.length}** รายการ กำลังไล่แนะนำให้ทีละอย่างครับ 👇`)
        .setFooter({ text: 'ระบบแจ้งเตือนสินค้าใหม่ · เตือนซ้ำอัตโนมัติ' })
        .setTimestamp();

      await announceChannel.send({ embeds: [introEmbed] });
      await sendMentionBelow(announceChannel);

      for (let i = 0; i < products.length; i++) {
        const { channel, categoryName } = products[i];
        const info = await fetchProductInfo(channel);

        const embed = new EmbedBuilder()
          .setColor(pickColor(i))
          .setAuthor({ name: `📦 สินค้าที่ ${i + 1}/${products.length}`, iconURL: client.user.displayAvatarURL() })
          .setTitle(`✨ ${channel.name.replace(/[-_]/g, ' ')}`)
          .setDescription(
            (info.text ? `${info.text}\n\n` : 'ยังไม่มีคำโปรยสินค้า สามารถปักหมุดข้อความในห้องนี้เพื่อให้บอทดึงมาโชว์ได้ครับ\n\n') +
            `🛍️ ดูรายละเอียด/สั่งซื้อได้ที่ <#${channel.id}>`,
          )
          .addFields({ name: '📁 หมวดหมู่', value: categoryName, inline: true })
          .setFooter({ text: 'ระบบแจ้งเตือนสินค้าใหม่' })
          .setTimestamp();

        const files = [];
        if (info.file) {
          files.push(info.file);
          embed.setImage(`attachment://${info.file.name}`);
        }

        await announceChannel.send({ embeds: [embed], files }).catch((err) => {
          console.error(`[โฆษณา] ส่งโฆษณาห้อง #${channel.name} ไม่สำเร็จ:`, err.message);
        });

        if (i < products.length - 1) await sleep(PER_PRODUCT_DELAY_MS);
      }
    } catch (err) {
      console.error('❌ [โฆษณา] เกิดข้อผิดพลาดตอนเตือนซ้ำ:', err);
    } finally {
      isSendingReminder = false;
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

      const categoryName = message.channel.parentId
        ? message.guild.channels.cache.get(message.channel.parentId)?.name ?? null
        : null;

      const embed = new EmbedBuilder()
        .setColor(COLOR_ANNOUNCE)
        .setAuthor({ name: '📢 มีสินค้าใหม่ / อัปเดตสินค้า!', iconURL: client.user.displayAvatarURL() })
        .setTitle(`✨ ${message.channel.name.replace(/[-_]/g, ' ')}`)
        .setDescription(
          (message.content?.trim() ? `💬 ${message.content.trim()}\n\n` : '') +
          `🛍️ เข้าไปดูกันเลยที่ <#${message.channel.id}>`,
        )
        .setFooter({ text: 'ระบบแจ้งเตือนสินค้าใหม่' })
        .setTimestamp();

      if (categoryName) {
        embed.addFields({ name: '📁 หมวดหมู่', value: categoryName, inline: true });
      }

      const files = [];
      const firstImage = message.attachments.find((a) => a.contentType?.startsWith('image/'));
      if (firstImage) {
        // ดาวน์โหลดรูปมาอัปโหลดใหม่เอง กันลิงก์ CDN หมดอายุทีหลัง
        const file = await downloadAsAttachment(firstImage.url, 'product');
        if (file) {
          files.push(file);
          embed.setImage(`attachment://${file.name}`);
        }
      }

      await announceChannel.send({ embeds: [embed], files });
      await sendMentionBelow(announceChannel);
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
