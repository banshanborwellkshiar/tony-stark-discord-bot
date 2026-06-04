'use strict';

/**
 * Server-admin actions for the Tony Stark bot.
 *
 * Handled in code (not the AI) so actions are explicit and reliable.
 * Admins/mods only (Administrator or Manage Server permission).
 *
 * Usage:
 *   @TonyStark create channel <name>           -> new text channel
 *   @TonyStark create voice <name>             -> new voice channel
 *   @TonyStark create category <name>          -> new category
 *   @TonyStark create role <name>              -> new role
 *   @TonyStark announce <message>              -> @everyone announcement (here)
 *   @TonyStark announce #channel <message>     -> announcement in that channel
 *   @TonyStark give @user <role name>          -> give a role to a member
 *   @TonyStark take @user <role name>          -> remove a role from a member
 */

const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

// Specific patterns so normal chat ("give me a joke") doesn't trigger admin actions.
const TRIGGERS = [
  /^create\s+(channel|voice|category|role)\b/i,
  /^announce\b/i,
  /^(give|take)\s+<@!?\d+>/i,
];

/** True when the (mention-stripped) text is an admin command. */
function isAdminCommand(text) {
  const t = text.trim();
  return TRIGGERS.some((re) => re.test(t));
}

/**
 * @param {import('discord.js').Message} message
 * @param {string} text - message with the bot mention already removed
 */
async function handleAdminCommand(message, text) {
  if (!message.guild) {
    await message.reply('🏠 This only works inside a server.');
    return;
  }
  if (!isAdmin(message.member)) {
    await message.reply('🔒 Only admins/mods can use that.');
    return;
  }

  const first = text.trim().split(/\s+/)[0].toLowerCase();
  try {
    if (first === 'create') return await handleCreate(message, text);
    if (first === 'announce') return await handleAnnounce(message, text);
    if (first === 'give') return await handleGiveTake(message, text, 'give');
    if (first === 'take') return await handleGiveTake(message, text, 'take');
  } catch (err) {
    console.error('admin command error:', err.message);
    await message.reply(
      `⚠️ Couldn't do that: ${err.message}. (Check my permissions and role position.)`
    );
  }
}

// ---------------------------------------------------------------------------

async function handleCreate(message, text) {
  const parts = text.trim().split(/\s+/);
  const kind = parts[1].toLowerCase();
  const name = parts.slice(2).join(' ').trim();
  if (!name) {
    await message.reply(`Usage: \`@TonyStark create ${kind} <name>\``);
    return;
  }

  if (kind === 'channel') {
    const ch = await message.guild.channels.create({ name, type: ChannelType.GuildText });
    await message.reply(`✅ Created text channel ${ch}.`);
  } else if (kind === 'voice') {
    const ch = await message.guild.channels.create({ name, type: ChannelType.GuildVoice });
    await message.reply(`✅ Created voice channel **${ch.name}**.`);
  } else if (kind === 'category') {
    const ch = await message.guild.channels.create({ name, type: ChannelType.GuildCategory });
    await message.reply(`✅ Created category **${ch.name}**.`);
  } else if (kind === 'role') {
    const role = await message.guild.roles.create({ name, mentionable: true });
    await message.reply(`✅ Created role ${role}.`);
  }
}

async function handleAnnounce(message, text) {
  let content = text.replace(/^announce\s*/i, '').trim();

  // Optional target channel: "announce #channel ..."
  let target = message.channel;
  const chMatch = content.match(/^<#(\d+)>\s*/);
  if (chMatch) {
    const ch = message.guild.channels.cache.get(chMatch[1]);
    if (ch) {
      target = ch;
      content = content.replace(/^<#\d+>\s*/, '').trim();
    }
  }

  if (!content) {
    await message.reply(
      'Usage: `@TonyStark announce <message>` or `@TonyStark announce #channel <message>`'
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📢 Announcement')
    .setDescription(content)
    .setColor(0xe67e22)
    .setFooter({ text: `Posted by ${message.author.username}` })
    .setTimestamp();

  await target.send({
    content: '@everyone',
    embeds: [embed],
    allowedMentions: { parse: ['everyone'] },
  });

  if (target.id !== message.channel.id) {
    await message.reply(`✅ Announced in ${target}.`);
  }
}

async function handleGiveTake(message, text, action) {
  const target = message.mentions.members?.filter(
    (m) => m.id !== message.client.user.id
  ).first();
  if (!target) {
    await message.reply(`Usage: \`@TonyStark ${action} @user <role name>\``);
    return;
  }

  const roleName = text
    .replace(/^(give|take)\s+/i, '')
    .replace(/<@!?\d+>/, '')
    .trim();
  if (!roleName) {
    await message.reply(`Which role? \`@TonyStark ${action} @user <role name>\``);
    return;
  }

  const role = message.guild.roles.cache.find(
    (r) => r.name.toLowerCase() === roleName.toLowerCase()
  );
  if (!role) {
    await message.reply(`I can't find a role called **${roleName}**.`);
    return;
  }

  if (action === 'give') {
    await target.roles.add(role);
    await message.reply(`✅ Gave ${role} to ${target}.`);
  } else {
    await target.roles.remove(role);
    await message.reply(`✅ Removed ${role} from ${target}.`);
  }
}

module.exports = { isAdminCommand, handleAdminCommand };
