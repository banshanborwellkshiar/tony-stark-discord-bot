'use strict';

/**
 * Server-admin actions for the Tony Stark bot.
 *
 * Handled in code (not the AI) so actions are explicit and reliable.
 * Admins/mods only (Administrator or Manage Server permission).
 *
 * Usage (flexible phrasing):
 *   @TonyStark create channel <name>            / "create a channel called <name>"
 *   @TonyStark create voice <name>              / "make a voice channel <name>"
 *   @TonyStark create category <name>
 *   @TonyStark create role <name>               / "make a new role <name>"
 *   @TonyStark announce <message>               / "announce #channel <message>"
 *   @TonyStark give @user <role name>
 *   @TonyStark take @user <role name>
 */

const { ChannelType, PermissionsBitField, EmbedBuilder } = require('discord.js');

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

// "create/make/add [a|an|the|new|text] <kind> [called|named|for] <name>"
const CREATE_RE =
  /^(?:create|make|add)\s+(?:(?:a|an|the|new|text)\s+)*(voice\s*channel|channel|voice|category|role)\b\s*(?:called\s+|named\s+|for\s+|:\s*)?(.*)$/i;
const ANNOUNCE_RE = /^announce\b/i;
const GIVE_TAKE_RE = /^(give|take)\s+<@!?\d+>/i;

/** True when the (mention-stripped) text is an admin command. */
function isAdminCommand(text) {
  const t = text.trim();
  return CREATE_RE.test(t) || ANNOUNCE_RE.test(t) || GIVE_TAKE_RE.test(t);
}

async function handleAdminCommand(message, text) {
  if (!message.guild) {
    await message.reply('🏠 This only works inside a server.');
    return;
  }
  if (!isAdmin(message.member)) {
    await message.reply('🔒 Only admins/mods can use that.');
    return;
  }

  const t = text.trim();
  try {
    if (CREATE_RE.test(t)) return await handleCreate(message, t);
    if (ANNOUNCE_RE.test(t)) return await handleAnnounce(message, text);
    const gt = t.match(/^(give|take)\b/i);
    if (gt) return await handleGiveTake(message, text, gt[1].toLowerCase());
  } catch (err) {
    console.error('admin command error:', err.message);
    await message.reply(
      `⚠️ Couldn't do that: ${err.message}. (Check my permissions and role position.)`
    );
  }
}

// ---------------------------------------------------------------------------

async function handleCreate(message, text) {
  const m = text.match(CREATE_RE);
  const kindRaw = m[1].toLowerCase().replace(/\s+/g, ' ');
  const name = (m[2] || '').trim();

  let kind;
  if (kindRaw === 'category') kind = 'category';
  else if (kindRaw === 'role') kind = 'role';
  else if (kindRaw === 'voice' || kindRaw === 'voice channel') kind = 'voice';
  else kind = 'channel'; // "channel" / "text channel"

  if (!name) {
    await message.reply(`What should I name the ${kind}? e.g. \`@TonyStark create ${kind} my-${kind}\``);
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
  const target = message.mentions.members
    ?.filter((m) => m.id !== message.client.user.id)
    .first();
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
