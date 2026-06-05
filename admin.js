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
const config = require('./config');

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
const LOCK_RE = /^(lock|restrict)\b/i;
const UNLOCK_RE = /^unlock\b/i;

/** True when the (mention-stripped) text is an admin command. */
function isAdminCommand(text) {
  const t = text.trim();
  return (
    CREATE_RE.test(t) ||
    ANNOUNCE_RE.test(t) ||
    GIVE_TAKE_RE.test(t) ||
    LOCK_RE.test(t) ||
    UNLOCK_RE.test(t)
  );
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
    if (UNLOCK_RE.test(t)) return await handleUnlock(message);
    if (LOCK_RE.test(t)) return await handleLock(message, t);
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
  // Use any #channel mentioned anywhere as the target; else the current channel.
  const target = message.mentions.channels?.first() || message.channel;

  // Strip "announce", the channel mention, and a leading filler word (in/to/on).
  let content = text
    .replace(/^announce\s*/i, '')
    .replace(/<#\d+>/g, '')
    .replace(/^\s*(?:in|to|on|into|at)\b\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!content) {
    await message.reply(
      'Usage: `@TonyStark announce #channel <message>` (or just `announce <message>` for here).'
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

async function handleLock(message, text) {
  const mentionedRole = message.mentions.roles?.first();
  let roleName;
  if (mentionedRole) {
    roleName = mentionedRole.name;
  } else {
    roleName = text
      .replace(/^(lock|restrict)(\s+to)?\s*/i, '')
      .replace(/<@&\d+>/g, '')
      .trim();
  }

  if (!roleName) {
    const current = config.getAllowedRole(message.guild.id);
    await message.reply(
      current
        ? `🔒 I'm currently locked to the **${current}** role. \`@TonyStark lock <role>\` to change, or \`@TonyStark unlock\` to open to everyone.`
        : 'Usage: `@TonyStark lock <role name>` (or @mention the role). Use `@TonyStark unlock` to remove it.'
    );
    return;
  }

  const role = message.guild.roles.cache.find(
    (r) => r.name.toLowerCase() === roleName.toLowerCase()
  );
  if (!role) {
    await message.reply(
      `I can't find a role called **${roleName}**. Create it first (\`@TonyStark create role ${roleName}\`) or check the spelling.`
    );
    return;
  }

  config.setAllowedRole(message.guild.id, role.name);
  await message.reply(
    `🔒 Locked. Now only members with the **${role.name}** role (and admins) can use me.\n` +
      `Give it to people with \`@TonyStark give @user ${role.name}\`. Run \`@TonyStark unlock\` to open it up again.`
  );
}

async function handleUnlock(message) {
  config.clearAllowedRole(message.guild.id);
  await message.reply('🔓 Unlocked. Everyone can use me again.');
}

module.exports = { isAdminCommand, handleAdminCommand };
