const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const QR_IMAGE_PATH = path.join(__dirname, 'qrcode.png'); // เปลี่ยนเป็นไฟล์ QR ร้านคุณได้ (แทนที่ไฟล์นี้)

// สีธีมของบอท ปรับได้ตามใจชอบ (โค้ดสี hex)
const COLOR_PRIMARY = 0x5865f2; // ม่วง-ฟ้า (โทน Discord)
const COLOR_SUCCESS = 0x57f287; // เขียว
const COLOR_WARNING = 0xfee75c; // เหลือง
const COLOR_DANGER = 0xed4245;  // แดง

// ชื่อขึ้นต้นของห้องทิกเก็ต — เปลี่ยนตรงนี้ถ้าห้องทิกเก็ตร้านคุณใช้ชื่อขึ้นต้นแบบอื่น
const TICKET_CHANNEL_PREFIX = 'ticket-';

function startPaymentBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const SLIP_CHANNEL_ID = process.env.SLIP_CHANNEL_ID;

  // เก็บรายชื่อห้องที่ "กำลังรอสลิป" อยู่ (หลังจากกด /โอนเงิน)
  const awaitingSlipChannels = new Set();

  // เก็บ ID ข้อความทั้งหมดที่เกี่ยวกับออเดอร์ในแต่ละห้อง (channelId -> [messageId, ...])
  const orderMessages = new Map();

  function trackMessage(channelId, messageId) {
    if (!orderMessages.has(channelId)) {
      orderMessages.set(channelId, []);
    }
    orderMessages.get(channelId).push(messageId);
  }

  // กันไม่ให้ประมวลผลรูปสลิปเดียวกันซ้ำสองรอบ
  const processedMessageIds = new Set();

  client.once('ready', () => {
    console.log(`✅ [โอนเงิน] บอทออนไลน์แล้ว: ${client.user.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    // ----- /โอนเงิน -----
    if (interaction.isChatInputCommand() && interaction.commandName === 'โอนเงิน') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('how_to_attach')
          .setLabel('วิธีแนบสลิป')
          .setEmoji('📎')
          .setStyle(ButtonStyle.Secondary),
      );

      const orderEmbed = new EmbedBuilder()
        .setTitle('💳 ชำระเงิน')
        .setDescription(
          '**ขั้นตอนการชำระเงิน**\n\n' +
          '`1` สแกน QR ด้านล่างเพื่อชำระเงิน\n' +
          '`2` แนบรูปสลิปในห้องนี้ได้เลย\n' +
          '`3` ระบบจะรับสลิปให้อัตโนมัติ ไม่ต้องกดอะไรเพิ่ม',
        )
        .setColor(COLOR_PRIMARY)
        .setImage('attachment://qrcode.png')
        .setFooter({ text: 'หากไม่ทราบวิธีแนบไฟล์ กดปุ่มด้านล่างได้เลย' });

      await interaction.reply({
        embeds: [orderEmbed],
        files: [{ attachment: QR_IMAGE_PATH, name: 'qrcode.png' }],
        components: [row],
      });

      awaitingSlipChannels.add(interaction.channel.id);

      const orderReply = await interaction.fetchReply();
      trackMessage(interaction.channel.id, orderReply.id);
    }

    // ----- กดปุ่มขอวิธีแนบสลิป -----
    if (interaction.isButton() && interaction.customId === 'how_to_attach') {
      const howToEmbed = new EmbedBuilder()
        .setTitle('📎 วิธีแนบสลิป')
        .setDescription(
          '`1` กดไอคอน **+** ข้างช่องพิมพ์ข้อความ (มุมล่างซ้าย)\n' +
          '`2` เลือก **Photos** แล้วเลือกรูปสลิปโอนเงิน\n' +
          '`3` กดส่งรูปในห้องนี้ได้เลย ระบบจะรับให้อัตโนมัติ',
        )
        .setColor(COLOR_PRIMARY);

      await interaction.reply({ embeds: [howToEmbed], ephemeral: true });
    }

    // ----- แอดมินกดปุ่มอนุมัติสลิปในห้องหลักฐาน -----
    if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
      const [, originChannelId, originMessageId] = interaction.customId.split('_');

      try {
        const originChannel = await client.channels.fetch(originChannelId);

        const messageIdsToDelete = new Set([
          originMessageId,
          ...(orderMessages.get(originChannelId) || []),
        ]);

        for (const msgId of messageIdsToDelete) {
          try {
            const msg = await originChannel.messages.fetch(msgId);
            await msg.delete();
          } catch (err) {
            console.error(`[โอนเงิน] ลบข้อความ ${msgId} ไม่สำเร็จ (อาจถูกลบไปแล้ว):`, err.message);
          }
        }

        orderMessages.delete(originChannelId);
      } catch (err) {
        console.error('[โอนเงิน] เกิดข้อผิดพลาดตอนลบข้อความ:', err.message);
      }

      const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(COLOR_SUCCESS)
        .spliceFields(2, 1, { name: 'สถานะ', value: `✅ อนุมัติแล้วโดย ${interaction.user}` });

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('approved_done')
          .setLabel('อนุมัติแล้ว')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
      );

      await interaction.update({ embeds: [approvedEmbed], components: [disabledRow] });

      try {
        await interaction.message.react('✅');
      } catch (err) {
        console.error('[โอนเงิน] ติด reaction ไม่สำเร็จ:', err.message);
      }
    }
  });

  // ----- ดักจับรูปที่แนบมาในห้องแชท (เฉพาะห้องทิกเก็ต) -----
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.attachments.size === 0) return;
    if (!message.guild) return;

    const channelName = message.channel.name || '';
    if (!channelName.startsWith(TICKET_CHANNEL_PREFIX)) return;
    if (message.channel.id === SLIP_CHANNEL_ID) return;
    if (!awaitingSlipChannels.has(message.channel.id)) return;
    if (processedMessageIds.has(message.id)) return;
    processedMessageIds.add(message.id);

    const attachment = message.attachments.first();
    const isImage = attachment.contentType?.startsWith('image/');
    if (!isImage) return;

    awaitingSlipChannels.delete(message.channel.id);

    const slipChannel = message.guild?.channels.cache.get(SLIP_CHANNEL_ID);

    if (!slipChannel) {
      return message.reply('❌ ระบบยังไม่ได้ตั้งค่าห้องเก็บสลิป (แจ้งแอดมิน)');
    }

    try {
      // ดาวน์โหลดรูปสลิปมาอัปโหลดใหม่เอง แทนที่จะแปะลิงก์ CDN ของรูปต้นฉบับตรงๆ
      // (ลิงก์ attachment.url มีวันหมดอายุ ผ่านไปนานๆ จะโหลดรูปไม่ขึ้น
      // อัปโหลดใหม่แบบนี้จะผูกกับข้อความของเราเอง ไม่มีวันหมดอายุ)
      const slipRes = await fetch(attachment.url);
      const slipBuffer = Buffer.from(await slipRes.arrayBuffer());
      const slipExt = (attachment.name?.split('.').pop() || 'png').toLowerCase();
      const slipFileName = `slip.${slipExt}`;

      const embed = new EmbedBuilder()
        .setTitle('📥 สลิปใหม่')
        .setColor(COLOR_WARNING)
        .addFields(
          { name: 'ลูกค้า', value: `${message.author} (${message.author.tag})`, inline: true },
          { name: 'ห้อง', value: `<#${message.channel.id}>`, inline: true },
          { name: 'สถานะ', value: '🕐 รอตรวจสอบ' },
        )
        .setImage(`attachment://${slipFileName}`)
        .setTimestamp();

      const approveRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${message.channel.id}_${message.id}`)
          .setLabel('อนุมัติ')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
      );

      await slipChannel.send({
        embeds: [embed],
        files: [{ attachment: slipBuffer, name: slipFileName }],
        components: [approveRow],
      });

      const confirmEmbed = new EmbedBuilder()
        .setDescription('✅ **ได้รับสลิปแล้ว** รอแอดมินตรวจสอบครับ')
        .setColor(COLOR_SUCCESS);

      const confirmMsg = await message.reply({ embeds: [confirmEmbed] });
      trackMessage(message.channel.id, confirmMsg.id);
    } catch (err) {
      console.error('[โอนเงิน] เกิดข้อผิดพลาดตอนจัดการสลิป:', err);
      awaitingSlipChannels.add(message.channel.id);
      message.reply('❌ เกิดข้อผิดพลาด กรุณาลองแนบสลิปใหม่อีกครั้ง หรือแจ้งแอดมิน');
    }
  });

  if (!process.env.PAYMENT_DISCORD_TOKEN) {
    console.warn('⚠️ [โอนเงิน] ไม่พบ PAYMENT_DISCORD_TOKEN ใน .env — บอทโอนเงินจะไม่ทำงาน');
    return client;
  }

  client.login(process.env.PAYMENT_DISCORD_TOKEN).catch((err) => {
    console.error('❌ [โอนเงิน] ล็อกอินไม่สำเร็จ (เช็ค PAYMENT_DISCORD_TOKEN):', err.message);
  });
  return client;
}

module.exports = { startPaymentBot };
