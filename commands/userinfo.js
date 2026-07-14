import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('userinfo')
  .setDescription('Shows information about a user.')
  .addUserOption((option) =>
    option
      .setName('user')
      .setDescription('The user to look up (defaults to you).')
      .setRequired(false),
  );

export async function execute(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle(user.tag)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
    )
    .setColor(0x5865f2)
    .setFooter({ text: `User ID: ${user.id}` });

  if (member?.joinedTimestamp) {
    embed.addFields({
      name: 'Joined server',
      value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`,
      inline: true,
    });
  }

  await interaction.reply({ embeds: [embed] });
}
