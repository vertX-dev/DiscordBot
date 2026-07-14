import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('announce')
  .setDescription('Posts an embed announcement as the bot to a channel.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o.setName('channel').setDescription('Where to post')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
  .addStringOption((o) => o.setName('message').setDescription('The announcement text').setRequired(true))
  .addStringOption((o) => o.setName('title').setDescription('Optional title').setRequired(false))
  .addStringOption((o) => o.setName('color').setDescription('Hex color, e.g. #5865F2').setRequired(false))
  .addBooleanOption((o) => o.setName('ping').setDescription('Ping @everyone (default: no)').setRequired(false));

export async function execute(interaction) {
  const channel = interaction.options.getChannel('channel');
  const message = interaction.options.getString('message');
  const title = interaction.options.getString('title');
  const colorRaw = interaction.options.getString('color');
  const ping = interaction.options.getBoolean('ping') ?? false;

  const me = interaction.guild.members.me;
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({ ephemeral: true, content: `I can't send messages in ${channel}.` });
  }

  let color = 0x5865f2;
  if (colorRaw) {
    const parsed = parseInt(colorRaw.replace('#', ''), 16);
    if (!Number.isNaN(parsed)) color = parsed;
  }

  const embed = new EmbedBuilder().setDescription(message).setColor(color).setTimestamp();
  if (title) embed.setTitle(title);
  embed.setFooter({ text: `Posted by ${interaction.user.tag}` });

  await channel.send({ content: ping ? '@everyone' : undefined, embeds: [embed] });
  await interaction.reply({ ephemeral: true, content: `✅ Announcement posted in ${channel}.` });
}
