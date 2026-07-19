import { ChannelType, EmbedBuilder } from 'discord.js';

// Opens a forum post in the named forum channel with a details embed. Shared by
// /suggest and /help (lightweight — status is handled by the existing /review).
// Returns the created thread, or null if the forum channel isn't found.
export async function createForumPost(guild, forumName, { title, body, author, color = 0x5865f2 }) {
  const forum = guild.channels.cache.find((c) => c.type === ChannelType.GuildForum && c.name === forumName);
  if (!forum) return null;

  const embed = new EmbedBuilder()
    .setTitle(title.slice(0, 256))
    .setDescription(body || '*No details provided.*')
    .setColor(color)
    .setFooter({ text: `by ${author.tag}` })
    .setTimestamp();

  return forum.threads.create({ name: title.slice(0, 100), message: { embeds: [embed] } });
}
