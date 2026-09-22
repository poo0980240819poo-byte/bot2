const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ไฟล์เก็บสถานะล่าสุด กันไม่ให้สถานะรีเซ็ตเป็นออนไลน์ทุกครั้งที่บอทรีสตาร์ท
const STATE_FILE = path.join(__dirname, '..', '.status-state.json');

function loadIsOnline() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw).isOnline;
  } catch {
    return true; // ไม่มีไฟล์ (รันครั้งแรก) -> ค่าเริ่มต้นออนไลน์
  }
}

function saveIsOnline(value) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ isOnline: value }));
  } catch (err) {
    console.error('[สถานะ] บันทึกไฟล์สถานะไม่สำเร็จ:', err.message);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// หน่วงเวลาก่อนส่งข้อความ "แอดมินไม่อยู่" กันไม่ให้ข้อความไปแทรกก่อนข้อความต้อนรับ
// ของบอทระบบทิกเก็ต (เช่น Tickets v2) ที่มักจะส่งข้อความแรกเข้ามาหลังห้องถูกสร้างเล็กน้อย
const OFFLINE_MESSAGE_DELAY_MS = 2000;

// ห้องทิกเก็ตต้องขึ้นต้นด้วยคำนี้ (ใช้ร่วมกับระบบทิกเก็ตของบอทโอนเงิน)
const TICKET_CHANNEL_PREFIX = 'ticket-';

const STATUS_ONLINE_ID = 'status_online';
const STATUS_OFFLINE_ID = 'status_offline';

const COLOR_ONLINE = 0x2bd576;  // เขียวมรกต
const COLOR_OFFLINE = 0xff4d5e; // แดงคอรัล

const DIVIDER = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';

function startStatusBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  // สถานะปัจจุบัน (โหลดจากไฟล์ .status-state.json ถ้ามี กันรีสตาร์ทแล้วสถานะเพี้ยน)
  let isOnline = loadIsOnline();

  // ห้องทิกเก็ตที่เปิดมาระหว่างที่แอดมินออฟไลน์ (รอแจ้งเตือนตอนกลับมาออนไลน์)
  const waitingTickets = new Set();

  const botAvatar = () => client.user?.displayAvatarURL() ?? undefined;

  // ----------------------------------------------------------------------
  // UI: แผงปุ่มสถานะ
  // ----------------------------------------------------------------------
  function buildStatusEmbed() {
    return new EmbedBuilder()
      .setColor(isOnline ? COLOR_ONLINE : COLOR_OFFLINE)
      .setAuthor({ name: '✨ 𝗦𝗧𝗔𝗧𝗨𝗦 • สถานะร้าน ✨', iconURL: botAvatar() })
      .setTitle(isOnline ? '🟢💎  ร้านเปิดให้บริการอยู่' : '🔴🌙  ร้านปิดให้บริการชั่วคราว')
      .setDescription(
        `${DIVIDER}\n` +
        (isOnline
          ? '⚡ ✨ พร้อมให้บริการเต็มที่ครับ เปิดทิกเก็ตเข้ามาได้เลย 🛍️'
          : '💤 🌙 แอดมินไม่อยู่ในขณะนี้ กลับมาจะรีบดำเนินการให้ครับ 🙏') +
        `\n${DIVIDER}`,
      )
      .addFields(
        { name: '📶✨  สถานะ', value: isOnline ? '```ansi\n\u001b[1;32mONLINE\u001b[0m\n```' : '```ansi\n\u001b[1;31mOFFLINE\u001b[0m\n```', inline: true },
        { name: '🕒⏱️  อัปเดตล่าสุด', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      )
      .setThumbnail(botAvatar())
      .setFooter({ text: 'เฉพาะแอดมิน (Manage Server) เท่านั้นที่กดปุ่มด้านล่างได้', iconURL: botAvatar() });
  }

  function buildStatusRow() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(STATUS_ONLINE_ID)
        .setLabel('ออนไลน์')
        .setEmoji('🟢')
        .setStyle(ButtonStyle.Success)
        .setDisabled(isOnline),
      new ButtonBuilder()
        .setCustomId(STATUS_OFFLINE_ID)
        .setLabel('ออฟไลน์')
        .setEmoji('🔴')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!isOnline),
    );
  }

  // ----------------------------------------------------------------------
  // UI: ข้อความในห้องทิกเก็ต
  // ----------------------------------------------------------------------
  function buildTicketOfflineEmbed() {
    return new EmbedBuilder()
      .setColor(COLOR_OFFLINE)
      .setAuthor({ name: '🔔 สถานะร้าน', iconURL: botAvatar() })
      .setTitle('⏳🌙  แอดมินไม่อยู่ในขณะนี้')
      .setDescription(
        'ฝากรายละเอียดไว้ได้เลยครับ กลับมาจะรีบดำเนินการให้ทันที ✨\n' +
        `${DIVIDER}\n` +
        '🛒 ** สั่งซื้อ / เติมอะไร**\n' +
        '🛠️ ** ต้องการปรับ / แก้ไขอะไร**\n' +
        '📝 ** รายละเอียดอื่น ๆ ที่อยากแจ้งไว้ก่อน**\n' +
        `${DIVIDER}\n` +
        '🙏 ขอบคุณที่รอนะครับ',
      )
      .setFooter({ text: 'ระบบแจ้งเตือนสถานะร้าน', iconURL: botAvatar() })
      .setTimestamp();
  }

  function buildTicketOnlineEmbed() {
    return new EmbedBuilder()
      .setColor(COLOR_ONLINE)
      .setAuthor({ name: '🔔 สถานะร้าน', iconURL: botAvatar() })
      .setTitle('🎉✅  แอดมินกลับมาออนไลน์แล้ว')
      .setDescription('ขอโทษที่ให้รอนานนะครับ 🙏💚 กำลังดำเนินการให้ทันทีเลยครับ ⚡🔥')
      .setFooter({ text: 'ระบบแจ้งเตือนสถานะร้าน', iconURL: botAvatar() })
      .setTimestamp();
  }

  // ----------------------------------------------------------------------
  // UI: ข้อความในห้องประกาศ (แท็กยศสมาชิกเฉพาะจุดนี้จุดเดียว)
  // ----------------------------------------------------------------------
  function buildAnnounceEmbed(online) {
    return new EmbedBuilder()
      .setColor(online ? COLOR_ONLINE : COLOR_OFFLINE)
      .setAuthor({ name: '📢✨ ประกาศสถานะร้าน ✨📢', iconURL: botAvatar() })
      .setTitle(online ? '🟢💎 ร้านเปิดรับบริการแล้ว !' : '🔴🌙 ร้านปิดรับบริการชั่วคราว')
      .setDescription(
        `${DIVIDER}\n` +
        (online
          ? '🎉 **แอดมินออนไลน์แล้วครับ** เปิดทิกเก็ตเข้ามาได้เลย 🛍️⚡'
          : '💤 **แอดมินไม่สะดวกในขณะนี้ครับ** กลับมาออนไลน์เมื่อไหร่จะแจ้งเตือนอีกครั้ง 🔔') +
        `\n${DIVIDER}`,
      )
      .addFields({ name: '🕒⏱️  เวลา', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false })
      .setThumbnail(botAvatar())
      .setFooter({ text: 'ระบบแจ้งเตือนสถานะร้าน', iconURL: botAvatar() })
      .setTimestamp();
  }

  async function sendAnnounce(online) {
    const announceChannelId = process.env.STATUS_ANNOUNCE_CHANNEL_ID;
    if (!announceChannelId) return;

    const announceChannel = await client.channels.fetch(announceChannelId).catch(() => null);
    if (!announceChannel) {
      console.warn('[สถานะ] ไม่พบห้องประกาศ กรุณาตรวจสอบค่า STATUS_ANNOUNCE_CHANNEL_ID');
      return;
    }

    const roleId = process.env.STATUS_MEMBER_ROLE_ID;
    await announceChannel.send({
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [buildAnnounceEmbed(online)],
      allowedMentions: roleId ? { roles: [roleId] } : undefined,
    });
  }

  client.once('ready', () => {
    console.log(`🛎️ [สถานะ] ล็อกอินสำเร็จในชื่อ ${client.user.tag}`);
  });

  // ----- มีคนเปิดห้องทิกเก็ตใหม่ -----
  client.on('channelCreate', async (channel) => {
    try {
      if (channel.type !== ChannelType.GuildText) return;
      if (!channel.name?.startsWith(TICKET_CHANNEL_PREFIX)) return;

      if (!isOnline) {
        waitingTickets.add(channel.id);

        // รอสักครู่ให้บอทระบบทิกเก็ต (เช่น Tickets v2) ส่งข้อความต้อนรับก่อน
        // ข้อความแอดมินไม่อยู่จะได้ไปอยู่ด้านล่างเสมอ
        await sleep(OFFLINE_MESSAGE_DELAY_MS);

        await channel.send({ embeds: [buildTicketOfflineEmbed()] });
      }
    } catch (err) {
      console.error('[สถานะ] เกิดข้อผิดพลาดตอนจัดการห้องทิกเก็ตใหม่:', err.message);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      // ----- /setup-status : โพสต์แผงปุ่มสถานะ -----
      if (interaction.isChatInputCommand() && interaction.commandName === 'setup-status') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: '❌ ต้องมีสิทธิ์ Manage Server ถึงจะใช้คำสั่งนี้ได้',
            ephemeral: true,
          });
        }

        await interaction.channel.send({
          embeds: [buildStatusEmbed()],
          components: [buildStatusRow()],
        });
        return interaction.reply({ content: '✅ ตั้งค่าแผงสถานะเรียบร้อย', ephemeral: true });
      }

      // ----- กดปุ่มออนไลน์ / ออฟไลน์ -----
      if (interaction.isButton() && (interaction.customId === STATUS_ONLINE_ID || interaction.customId === STATUS_OFFLINE_ID)) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: '❌ ต้องมีสิทธิ์ Manage Server ถึงจะกดปุ่มนี้ได้',
            ephemeral: true,
          });
        }

        const goingOnline = interaction.customId === STATUS_ONLINE_ID;

        if (goingOnline === isOnline) {
          // กดปุ่มสถานะเดิมซ้ำ หรือ panel ไม่ sync กับสถานะจริง (เช่นหลัง bot รีสตาร์ท
          // แล้ว isOnline รีเซ็ตเป็น true แต่ panel ในดิสคอร์ดยังโชว์ค้างเป็นออฟไลน์)
          // -> อัปเดต embed/ปุ่มให้ตรงกับสถานะจริงเสมอ แทนที่จะเงียบไปเฉยๆ (แก้ปัญหาปุ่มค้าง/กดไม่ตอบสนอง)
          return interaction.update({
            embeds: [buildStatusEmbed()],
            components: [buildStatusRow()],
          });
        }

        isOnline = goingOnline;
        saveIsOnline(isOnline);

        // อัปเดตแผงปุ่มให้ตรงสถานะล่าสุด
        await interaction.update({
          embeds: [buildStatusEmbed()],
          components: [buildStatusRow()],
        });

        // ----- แจ้งเตือนห้องประกาศทุกครั้งที่เปลี่ยนสถานะ (แท็กยศสมาชิกเฉพาะจุดนี้) -----
        await sendAnnounce(isOnline);

        if (isOnline) {
          // ----- แจ้งเตือนทุกห้องทิกเก็ตที่เปิดมาตอนออฟไลน์ (ไม่แท็กยศ เฉพาะห้องประกาศเท่านั้น) -----
          for (const ticketChannelId of waitingTickets) {
            try {
              const ticketChannel = await client.channels.fetch(ticketChannelId);
              await ticketChannel.send({ embeds: [buildTicketOnlineEmbed()] });
            } catch (err) {
              console.error(`[สถานะ] แจ้งเตือนห้อง ${ticketChannelId} ไม่สำเร็จ (อาจถูกปิด/ลบไปแล้ว):`, err.message);
            }
          }
          waitingTickets.clear();
        }
      }
    } catch (err) {
      console.error('❌ [สถานะ] เกิดข้อผิดพลาดใน interactionCreate:', err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true }).catch(() => {});
      }
    }
  });

  if (!process.env.STATUS_DISCORD_TOKEN) {
    console.warn('⚠️ [สถานะ] ไม่พบ STATUS_DISCORD_TOKEN ใน .env — บอทสถานะจะไม่ทำงาน');
    return client;
  }

  client.login(process.env.STATUS_DISCORD_TOKEN).catch((err) => {
    console.error('❌ [สถานะ] ล็อกอินไม่สำเร็จ (เช็ค STATUS_DISCORD_TOKEN):', err.message);
  });
  return client;
}

module.exports = { startStatusBot };
