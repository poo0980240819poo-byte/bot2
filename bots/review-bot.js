const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

// =====================================================================
// 🛒 รายการสินค้า/บริการที่ให้ลูกค้าเลือกตอนเขียนรีวิว
// แก้ไข/เพิ่ม/ลบได้เลยตรงนี้ — แต่ละอันมี value (ห้ามซ้ำกัน, ห้ามมีเว้นวรรค/ตัวอักษรพิเศษ),
// label (ข้อความที่ลูกค้าเห็น), และ emoji (ไม่บังคับ)
// สูงสุด 25 รายการ (ข้อจำกัดของ Discord)
// =====================================================================
const PRODUCTS = [
  // ---------- WINDOW OS ----------
  { value: 'kernel', label: 'KERNEL', emoji: '💿' },
  { value: 'gg_os', label: 'GG-OS', emoji: '💿' },
  { value: 'ghost', label: 'GHOST', emoji: '💿' },
  { value: 'aura_iot_ltsc', label: 'AURA-IoT-Enterprise-LTSC', emoji: '💿' },
  { value: 'snyx_os', label: 'SNYX-OS', emoji: '💿' },
  { value: '10_ltsc', label: '10-LTSC', emoji: '💿' },
  // ---------- WINDOWS PLAYBOOK ----------
  { value: 'jrtwec_x', label: 'JRTWEC-X', emoji: '🖥️' },
  { value: 'atlas', label: 'ATLAS', emoji: '🖥️' },
  { value: 'fsos_x', label: 'FSOS-X', emoji: '🖥️' },
  { value: 'sapphireos', label: 'SapphireOS', emoji: '🖥️' },
  // ---------- FIVEM ----------
  { value: 'boots_fps_pack', label: 'Boots-FPS-pack', emoji: '🎮' },
  { value: 'reduce_delay_kbm', label: 'ลดดีเลย์คีย์บอร์ด/เมาส์', emoji: '🎮' },
  { value: 'program', label: 'Program', emoji: '🎮' },
  { value: 'increase_hz_cpu', label: 'เพิ่ม-HZ-CPU', emoji: '🎮' },
  { value: 'setting_bios', label: 'Setting BIOS', emoji: '🎮' },
  // ---------- อื่นๆ ----------
  { value: 'other', label: 'อื่นๆ', emoji: '📦' },
];

const PRODUCT_SELECT_ID = 'select_review_product';
const REVIEW_MODAL_PREFIX = 'review_modal';
const RATING_INPUT_ID = 'review_rating';
const COMMENT_INPUT_ID = 'review_comment';

function startReviewBot() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once('ready', () => {
    console.log(`🤖 [รีวิว] ล็อกอินสำเร็จในชื่อ ${client.user.tag}`);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      // ---------- /setup-review : โพสต์แผงเลือกสินค้า ----------
      if (interaction.isChatInputCommand() && interaction.commandName === 'setup-review') {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: '❌ ต้องมีสิทธิ์ Manage Server ถึงจะใช้คำสั่งนี้ได้',
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('⭐ แบ่งปันรีวิวของคุณ')
          .setDescription(
            'เลือก **สินค้า/บริการ** ที่คุณใช้จากเมนูด้านล่าง แล้วให้คะแนน + เขียนรีวิวได้เลย\n' +
            'รีวิวของคุณจะถูกโพสต์ลงในห้องนี้ทันที ไม่ต้องพิมพ์คำสั่งใดๆ'
          )
          .setFooter({
            text: `${interaction.guild?.name ?? 'ร้านของเรา'} • ขอบคุณที่สละเวลารีวิวให้เรา 💜`,
            iconURL: interaction.guild?.iconURL() || undefined,
          });

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(PRODUCT_SELECT_ID)
            .setPlaceholder('📝 เลือกสินค้า/บริการเพื่อเขียนรีวิว')
            .addOptions(
              PRODUCTS.map((p) => ({
                label: p.label,
                value: p.value,
                emoji: p.emoji,
              })),
            ),
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: '✅ ตั้งค่าแผงรีวิวเรียบร้อย', ephemeral: true });
      }

      // ---------- เลือกสินค้าจากเมนู -> เด้ง Modal ----------
      if (interaction.isStringSelectMenu() && interaction.customId === PRODUCT_SELECT_ID) {
        const productValue = interaction.values[0];

        const modal = new ModalBuilder()
          .setCustomId(`${REVIEW_MODAL_PREFIX}:${productValue}`)
          .setTitle('เขียนรีวิว');

        const ratingInput = new TextInputBuilder()
          .setCustomId(RATING_INPUT_ID)
          .setLabel('ให้คะแนน (1-5)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('ใส่ตัวเลข 1 ถึง 5')
          .setMinLength(1)
          .setMaxLength(1)
          .setRequired(true);

        const commentInput = new TextInputBuilder()
          .setCustomId(COMMENT_INPUT_ID)
          .setLabel('ความคิดเห็นของคุณ')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('เล่าประสบการณ์ของคุณ...')
          .setMaxLength(1000)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(ratingInput),
          new ActionRowBuilder().addComponents(commentInput),
        );

        return interaction.showModal(modal);
      }

      // ---------- ส่ง Modal -> โพสต์รีวิวลงห้อง ----------
      if (interaction.isModalSubmit() && interaction.customId.startsWith(`${REVIEW_MODAL_PREFIX}:`)) {
        const productValue = interaction.customId.split(':')[1];
        const product = PRODUCTS.find((p) => p.value === productValue);

        const ratingRaw = interaction.fields.getTextInputValue(RATING_INPUT_ID).trim();
        const comment = interaction.fields.getTextInputValue(COMMENT_INPUT_ID).trim();

        const rating = parseInt(ratingRaw, 10);
        if (isNaN(rating) || rating < 1 || rating > 5) {
          return interaction.reply({
            content: '❌ กรุณาใส่คะแนนเป็นตัวเลข 1-5 เท่านั้น ลองเลือกสินค้าและรีวิวใหม่อีกครั้ง',
            ephemeral: true,
          });
        }

        const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);

        // สีของ embed จะไล่ตามคะแนน — 5 ดาว = ทอง, 4 = เขียว, 3 = เหลือง, 2-1 = แดง
        const ratingColors = { 5: 0xffd700, 4: 0x57f287, 3: 0xfee75c, 2: 0xed4245, 1: 0xed4245 };

        const DIVIDER = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';

        const reviewEmbed = new EmbedBuilder()
          .setColor(ratingColors[rating] ?? 0xfee75c)
          .setAuthor({
            name: `📝 รีวิวใหม่จาก ${interaction.user.tag}`,
            iconURL: interaction.user.displayAvatarURL(),
          })
          .setTitle(`${stars}   ·   ${rating}/5`)
          .setDescription(
            `${DIVIDER}\n` +
            `💬 *"${comment}"*\n` +
            `${DIVIDER}`,
          )
          .addFields(
            { name: '🛒  สินค้า/บริการ', value: `${product?.emoji ?? '📦'} **${product?.label ?? 'ไม่ระบุ'}**`, inline: true },
            { name: '👤  รีวิวโดย', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📅  วันที่', value: `<t:${Math.floor(Date.now() / 1000)}:D>`, inline: true },
          )
          .setThumbnail(interaction.guild?.iconURL() || interaction.user.displayAvatarURL())
          .setFooter({
            text: `✦ ${interaction.guild?.name ?? ''} ✦ ขอบคุณที่สละเวลารีวิวให้เรา 💜`,
            iconURL: interaction.guild?.iconURL() || undefined,
          })
          .setTimestamp();

        const reviewChannelId = process.env.REVIEW_CHANNEL_ID;
        const targetChannel = reviewChannelId
          ? await client.channels.fetch(reviewChannelId).catch(() => null)
          : interaction.channel;

        if (!targetChannel) {
          return interaction.reply({
            content: '❌ ไม่พบห้องรีวิว กรุณาตรวจสอบค่า REVIEW_CHANNEL_ID',
            ephemeral: true,
          });
        }

        await targetChannel.send({ embeds: [reviewEmbed] });

        return interaction.reply({
          content: '✅ ขอบคุณสำหรับรีวิวของคุณ!',
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error('❌ [รีวิว] เกิดข้อผิดพลาดใน interactionCreate:', err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true }).catch(() => {});
      }
    }
  });

  if (!process.env.REVIEW_DISCORD_TOKEN) {
    console.warn('⚠️ [รีวิว] ไม่พบ REVIEW_DISCORD_TOKEN ใน .env — บอทรีวิวจะไม่ทำงาน');
    return client;
  }

  client.login(process.env.REVIEW_DISCORD_TOKEN).catch((err) => {
    console.error('❌ [รีวิว] ล็อกอินไม่สำเร็จ (เช็ค REVIEW_DISCORD_TOKEN):', err.message);
  });
  return client;
}

module.exports = { startReviewBot };
