require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const reviewCommands = [
  new SlashCommandBuilder()
    .setName('setup-review')
    .setDescription('โพสต์แผงเลือกสินค้าเพื่อเขียนรีวิว (แอดมินเท่านั้น)')
    .setDefaultMemberPermissions(0),
].map((c) => c.toJSON());

const paymentCommands = [
  new SlashCommandBuilder()
    .setName('โอนเงิน')
    .setDescription('เริ่มการสั่งซื้อและชำระเงิน'),
].map((c) => c.toJSON());

const statusCommands = [
  new SlashCommandBuilder()
    .setName('setup-status')
    .setDescription('โพสต์แผงปุ่มสถานะออนไลน์/ออฟไลน์ของแอดมิน (แอดมินเท่านั้น)')
    .setDefaultMemberPermissions(0),
].map((c) => c.toJSON());

async function deployFor(label, token, clientId, commands) {
  if (!token || !clientId) {
    console.warn(`⚠️ ข้าม deploy [${label}] เพราะไม่พบ TOKEN หรือ CLIENT_ID ใน .env`);
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), { body: commands });
      console.log(`✅ [${label}] Deploy คำสั่งสำเร็จไปที่เซิร์ฟเวอร์ GUILD_ID=${process.env.GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log(`✅ [${label}] Deploy คำสั่งสำเร็จแบบ Global (อาจใช้เวลาซิงก์ถึง 1 ชั่วโมง)`);
    }
  } catch (error) {
    console.error(`❌ [${label}] Deploy คำสั่งล้มเหลว:`, error);
  }
}

(async () => {
  await deployFor('รีวิว', process.env.REVIEW_DISCORD_TOKEN, process.env.REVIEW_CLIENT_ID, reviewCommands);
  await deployFor('โอนเงิน', process.env.PAYMENT_DISCORD_TOKEN, process.env.PAYMENT_CLIENT_ID, paymentCommands);
  await deployFor('สถานะ', process.env.STATUS_DISCORD_TOKEN, process.env.STATUS_CLIENT_ID, statusCommands);
})();
