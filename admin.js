'use strict';

/**
 * Server-admin actions for the Tony Stark bot (create channels & roles).
 *
 * Handled in code (not the AI) so actions are explicit and reliable.
 * Admins/mods only (Administrator or Manage Server permission).
 *
 * Usage:
 *   @TonyStark create channel <name>      -> new text channel
 *   @TonyStark create voice <name>        -> new voice channel
 *   @TonyStark create category <name>     -> new category
 *   @TonyStark create role <name>         -> new role
 */

const { ChannelType, PermissionsBitField } = require('discord.js');

function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

// Matches "create channel|voice|category|role ..." (case-insensitive).
const TRIGGER = /^create\s+(channel|voice|category|role)\b/i;

/** True when the (mention-stripped) text is an admin create-command. */
function isAdminCommand(text) {
  return TRIGGER.test(text.trim());
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
    await message.reply('🔒 Only admins/mods can create channels or roles.');
    return;
  }

  const parts = text.trim().split(/\s+/);
  const kind = parts[1].toLowerCase(); // channel | voice | category | role
  const name = parts.slice(2).join(' ').trim();

  if (!name) {
    await message.reply(`Usage: \`@TonyStark create ${kind} <name>\``);
    return;
  }

  try {
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
  } catch (err) {
    console.error('admin command error:', err.message);
    await message.reply(
      `⚠️ Couldn't do that: ${err.message}. (Check that I have the **Manage Channels / Manage Roles** permission and that my role is high enough.)`
    );
  }
}

module.exports = { isAdminCommand, handleAdminCommand };
