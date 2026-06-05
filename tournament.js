'use strict';

/**
 * Tournament system for the Tony Stark bot.
 *
 * Flow:
 *   1. An admin runs:  @TonyStark tournament create <name>
 *      -> the bot posts an announcement embed and adds a ✅ reaction.
 *   2. Players join by reacting ✅ on that announcement.
 *   3. An admin runs:  @TonyStark tournament start <name>
 *      -> the bot reads who reacted, shuffles them, and posts a random
 *         round-1 bracket (with a BYE if the count is odd).
 *
 * Tournaments are persisted to tournaments.json so they survive bot restarts.
 * This is handled in code (not by the AI) so player lists and brackets are
 * always exact and reliable.
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');

const DATA_FILE = path.join(__dirname, 'tournaments.json');
const JOIN_EMOJI = '✅';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let store = load();

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read tournaments.json:', err.message);
  }
  return {};
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('Failed to write tournaments.json:', err.message);
  }
}

function guildBucket(guildId) {
  if (!store[guildId]) store[guildId] = {};
  return store[guildId];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Admins/mods only: Administrator OR Manage Server permission. */
function isAdmin(member) {
  if (!member) return false;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Fetches the non-bot users who reacted ✅ on a tournament's announcement. */
async function fetchPlayers(message, tournament) {
  const channel = await message.client.channels.fetch(tournament.channelId);
  const announce = await channel.messages.fetch(tournament.messageId);
  const reaction = announce.reactions.cache.get(JOIN_EMOJI);
  if (!reaction) return [];
  const users = await reaction.users.fetch(); // up to 100 players
  return [...users.values()].filter((u) => !u.bot);
}

// ---------------------------------------------------------------------------
// Command router
// ---------------------------------------------------------------------------

/** True when the (mention-stripped) text is a tournament command. */
function isTournamentCommand(text) {
  const t = text.trim().toLowerCase();
  return (
    t === 'tournament' ||
    t === 'tourney' ||
    t.startsWith('tournament ') ||
    t.startsWith('tourney ')
  );
}

/**
 * Handles a tournament command.
 * @param {import('discord.js').Message} message
 * @param {string} text - the message with the bot mention already removed,
 *                        e.g. "tournament create Free Fire Cup"
 */
async function handleTournamentCommand(message, text) {
  const parts = text.trim().split(/\s+/);
  const sub = (parts[1] || 'help').toLowerCase();
  const name = parts.slice(2).join(' ').trim();

  try {
    switch (sub) {
      case 'create':
        return await createTournament(message, name);
      case 'start':
        return await startTournament(message, name);
      case 'list':
        return await listTournaments(message);
      case 'players':
      case 'player':
        return await listPlayers(message, name);
      case 'result':
      case 'win':
      case 'won':
        return await resultMatch(message, name);
      case 'bracket':
      case 'standings':
      case 'round':
        return await showBracket(message, name);
      case 'cancel':
      case 'delete':
        return await cancelTournament(message, name);
      default:
        return await showHelp(message);
    }
  } catch (err) {
    console.error('Tournament command error:', err);
    await message.reply(
      '⚠️ Something went wrong with that tournament command. ' +
        '(Make sure I can see the announcement message and have the right permissions.)'
    );
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function createTournament(message, name) {
  if (!isAdmin(message.member)) {
    return message.reply('🔒 Only admins/mods can create tournaments.');
  }
  if (!name) {
    return message.reply('Usage: `@TonyStark tournament create <name>`');
  }

  const bucket = guildBucket(message.guild.id);
  const key = name.toLowerCase();
  if (bucket[key]) {
    return message.reply(
      `⚠️ A tournament named **${name}** already exists. Cancel it first or pick another name.`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${name}`)
    .setDescription(
      `A new tournament has begun!\n\n` +
        `React with ${JOIN_EMOJI} below to **join**.\n` +
        `When sign-ups close, an admin runs \`tournament start ${name}\` to lock entries and generate the bracket.`
    )
    .addFields(
      { name: 'Status', value: '🟢 Open for sign-ups', inline: true },
      { name: 'How to join', value: `React ${JOIN_EMOJI}`, inline: true }
    )
    .setFooter({ text: `Hosted by ${message.author.username}` })
    .setColor(0xe74c3c)
    .setTimestamp();

  const announce = await message.channel.send({ embeds: [embed] });
  await announce.react(JOIN_EMOJI);

  bucket[key] = {
    name,
    channelId: announce.channelId,
    messageId: announce.id,
    createdBy: message.author.id,
    createdAt: new Date().toISOString(),
    status: 'open',
  };
  save();

  await message.reply(
    `✅ Tournament **${name}** is live! Players join by reacting ${JOIN_EMOJI} on the announcement above.`
  );
}

async function startTournament(message, name) {
  if (!isAdmin(message.member)) {
    return message.reply('🔒 Only admins/mods can start tournaments.');
  }
  if (!name) {
    return message.reply('Usage: `@TonyStark tournament start <name>`');
  }

  const bucket = guildBucket(message.guild.id);
  const tournament = bucket[name.toLowerCase()];
  if (!tournament) {
    return message.reply(
      `No tournament named **${name}**. See \`tournament list\`.`
    );
  }

  const players = await fetchPlayers(message, tournament);
  if (players.length < 2) {
    return message.reply(
      `Need at least **2 players** to start **${tournament.name}** (currently ${players.length}).`
    );
  }

  const shuffledIds = shuffle(players).map((p) => p.id);
  tournament.round = 1;
  tournament.matches = makeMatches(shuffledIds);
  tournament.status = 'started';
  save();

  await message.channel.send('🏁 **Sign-ups are closed — here is the bracket!**');
  await postRound(message.channel, tournament);
}

// ---------------------------------------------------------------------------
// Bracket & scoring
// ---------------------------------------------------------------------------

/** Pairs an ordered list of player IDs into matches; an odd one out gets a bye. */
function makeMatches(playerIds) {
  const matches = [];
  for (let i = 0; i < playerIds.length; i += 2) {
    const a = playerIds[i];
    const b = playerIds[i + 1] || null;
    matches.push({ a, b, winner: b ? null : a }); // bye auto-advances
  }
  return matches;
}

/** Posts the current round's bracket (winners marked with ✅). */
async function postRound(channel, t) {
  const lines = t.matches.map((m, i) => {
    if (!m.b) return `**Match ${i + 1}:** <@${m.a}> 🎟️ *(bye — advances)*`;
    const a = m.winner === m.a ? `__<@${m.a}>__ ✅` : `<@${m.a}>`;
    const b = m.winner === m.b ? `__<@${m.b}>__ ✅` : `<@${m.b}>`;
    return `**Match ${i + 1}:** ${a} 🆚 ${b}`;
  });
  const embed = new EmbedBuilder()
    .setTitle(`🥊 ${t.name} — Round ${t.round}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Report a winner: tournament result ${t.name} @winner` })
    .setColor(0xf1c40f)
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function resultMatch(message, rawName) {
  if (!isAdmin(message.member)) {
    return message.reply('🔒 Only admins/mods can report results.');
  }
  const winner = message.mentions.users
    ?.filter((u) => u.id !== message.client.user.id)
    .first();
  if (!winner) {
    return message.reply('Usage: `@TonyStark tournament result <name> @winner`');
  }
  const name = rawName.replace(/<@!?\d+>/g, '').trim();
  if (!name) {
    return message.reply('Which tournament? `tournament result <name> @winner`');
  }

  const bucket = guildBucket(message.guild.id);
  const t = bucket[name.toLowerCase()];
  if (!t) return message.reply(`No tournament named **${name}**.`);
  if (t.status !== 'started' || !t.matches) {
    return message.reply(`**${t.name}** isn't in progress. Start it first.`);
  }

  const match = t.matches.find(
    (m) => (m.a === winner.id || m.b === winner.id) && !m.winner
  );
  if (!match) {
    return message.reply(`${winner} isn't in an unfinished match this round.`);
  }

  match.winner = winner.id;
  save();
  await message.reply(`✅ ${winner} advances!`);

  if (t.matches.every((m) => m.winner)) {
    await advanceRound(message.channel, t);
  }
}

async function advanceRound(channel, t) {
  const winners = t.matches.map((m) => m.winner);
  if (winners.length === 1) {
    t.status = 'finished';
    save();
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${t.name} — Champion!`)
      .setDescription(`👑 <@${winners[0]}> wins it all! 🎉`)
      .setColor(0xffd700)
      .setTimestamp();
    await channel.send({ content: '🏁 **Tournament complete!**', embeds: [embed] });
    return;
  }
  t.round += 1;
  t.matches = makeMatches(winners);
  save();
  await channel.send(`➡️ On to **Round ${t.round}**!`);
  await postRound(channel, t);
  // A fresh round could already be settled if it's all byes.
  if (t.matches.every((m) => m.winner)) await advanceRound(channel, t);
}

async function showBracket(message, name) {
  if (!name) return message.reply('Usage: `@TonyStark tournament bracket <name>`');
  const bucket = guildBucket(message.guild.id);
  const t = bucket[name.toLowerCase()];
  if (!t) return message.reply(`No tournament named **${name}**.`);
  if (!t.matches) return message.reply(`**${t.name}** hasn't started yet.`);
  await postRound(message.channel, t);
}

async function listPlayers(message, name) {
  if (!name) {
    return message.reply('Usage: `@TonyStark tournament players <name>`');
  }
  const bucket = guildBucket(message.guild.id);
  const tournament = bucket[name.toLowerCase()];
  if (!tournament) {
    return message.reply(`No tournament named **${name}**.`);
  }

  const players = await fetchPlayers(message, tournament);
  if (players.length === 0) {
    return message.reply(`No players have joined **${tournament.name}** yet.`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`👥 ${tournament.name} — Players (${players.length})`)
    .setDescription(players.map((u, i) => `${i + 1}. ${u}`).join('\n'))
    .setColor(0x3498db);
  await message.reply({ embeds: [embed] });
}

async function listTournaments(message) {
  const bucket = guildBucket(message.guild.id);
  const entries = Object.values(bucket);
  if (entries.length === 0) {
    return message.reply(
      'No tournaments yet. Create one with `@TonyStark tournament create <name>`.'
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('🏆 Tournaments')
    .setDescription(
      entries
        .map(
          (t) =>
            `• **${t.name}** — ${t.status === 'open' ? '🟢 open for sign-ups' : '🏁 started'}`
        )
        .join('\n')
    )
    .setColor(0xe74c3c);
  await message.reply({ embeds: [embed] });
}

async function cancelTournament(message, name) {
  if (!isAdmin(message.member)) {
    return message.reply('🔒 Only admins/mods can cancel tournaments.');
  }
  if (!name) {
    return message.reply('Usage: `@TonyStark tournament cancel <name>`');
  }
  const bucket = guildBucket(message.guild.id);
  const key = name.toLowerCase();
  if (!bucket[key]) {
    return message.reply(`No tournament named **${name}**.`);
  }
  delete bucket[key];
  save();
  await message.reply(`🗑️ Tournament **${name}** has been cancelled.`);
}

async function showHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle('🏆 Tony Stark Tournaments')
    .setDescription(
      [
        '`@TonyStark tournament create <name>` — start a new tournament *(admin)*',
        '`@TonyStark tournament list` — show all tournaments',
        '`@TonyStark tournament players <name>` — who has joined',
        '`@TonyStark tournament start <name>` — lock entries & make the bracket *(admin)*',
        '`@TonyStark tournament result <name> @winner` — report a match winner *(admin)*',
        '`@TonyStark tournament bracket <name>` — show the current bracket',
        '`@TonyStark tournament cancel <name>` — delete a tournament *(admin)*',
        '',
        `🙋 Players join by reacting ${JOIN_EMOJI} on the tournament announcement.`,
        '🏆 Winners auto-advance round by round until a champion is crowned.',
      ].join('\n')
    )
    .setColor(0x95a5a6);
  await message.reply({ embeds: [embed] });
}

module.exports = { handleTournamentCommand, isTournamentCommand };
