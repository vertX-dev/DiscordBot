import {
  SlashCommandBuilder, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} from 'discord.js';
import {
  rrsSuggest, rrsRegister, rrsApprove, rrsRemove, rrsList, rrsBumpVersion,
} from '../lib/db.js';
import {
  isAddonMaintainer, validateMaterial, validateItemType, buildPackBuffer, resolveForumThread,
} from '../lib/raritystats.js';
import { MAINTAINER_ROLE, VERSION_MAJOR_MINOR } from '../config/raritystats.js';

export const data = new SlashCommandBuilder()
  .setName('rrs')
  .setDescription('Rarity & Stats support pack: register materials/item types and generate the pack.')
  .setDMPermission(false)
  .addSubcommandGroup((g) => g.setName('suggest').setDescription('Suggest a registration (needs maintainer approval).')
    .addSubcommand((s) => s.setName('material').setDescription('Suggest a material.'))
    .addSubcommand((s) => s.setName('itemtype').setDescription('Suggest an item type.')))
  .addSubcommandGroup((g) => g.setName('register').setDescription(`Register directly (approved). @${MAINTAINER_ROLE} only.`)
    .addSubcommand((s) => s.setName('material').setDescription('Register a material.'))
    .addSubcommand((s) => s.setName('itemtype').setDescription('Register an item type.')))
  .addSubcommand((s) => s.setName('approve').setDescription(`Approve a suggestion. @${MAINTAINER_ROLE} only.`)
    .addIntegerOption((o) => o.setName('id').setDescription('Registration id').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription(`Remove a registration. @${MAINTAINER_ROLE} only.`)
    .addIntegerOption((o) => o.setName('id').setDescription('Registration id').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('List registrations.')
    .addStringOption((o) => o.setName('kind').setDescription('Filter').setRequired(false)
      .addChoices({ name: 'materials', value: 'material' }, { name: 'item types', value: 'itemType' }))
    .addStringOption((o) => o.setName('status').setDescription('Filter').setRequired(false)
      .addChoices({ name: 'approved', value: 'approved' }, { name: 'pending', value: 'pending' })))
  .addSubcommand((s) => s.setName('generate').setDescription(`Build + post the support pack. @${MAINTAINER_ROLE} only.`))
  .addSubcommand((s) => s.setName('setforum').setDescription(`Create/pin the support-pack forum post here. @${MAINTAINER_ROLE} only.`));

const deny = (interaction) => interaction.reply({ ephemeral: true, content: `Only **@${MAINTAINER_ROLE}** can do that.` });

export async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'suggest') return showRegModal(interaction, sub, 'pending');
  if (group === 'register') {
    if (!isAddonMaintainer(interaction.member)) return deny(interaction);
    return showRegModal(interaction, sub, 'approved');
  }
  if (sub === 'list') return list(interaction);

  // maintainer-only from here
  if (!isAddonMaintainer(interaction.member)) return deny(interaction);
  if (sub === 'approve') return approve(interaction);
  if (sub === 'remove') return remove(interaction);
  if (sub === 'generate') return generate(interaction);
  if (sub === 'setforum') return setforum(interaction);
}

// --- Modals ------------------------------------------------------------------
function showRegModal(interaction, kindSub, mode) {
  const isMaterial = kindSub === 'material';
  const modal = new ModalBuilder()
    .setCustomId(`rrs|${isMaterial ? 'mat' : 'type'}|${mode}`)
    .setTitle(`${mode === 'approved' ? 'Register' : 'Suggest'} ${isMaterial ? 'material' : 'item type'}`);

  const rows = isMaterial
    ? [
      field('material', 'Material substring (e.g. mythril)', TextInputStyle.Short, true, 'mythril'),
      field('maxRarity', 'Max rarity (rank number or tier slug)', TextInputStyle.Short, true, '5  or  legendary'),
      field('weights', 'rarityWeightMods (JSON)', TextInputStyle.Paragraph, true, '{"common":1.0,"rare":1.2,"epic":0.4}'),
      field('costMods', 'costMods (JSON, optional)', TextInputStyle.Paragraph, false, '{"common":{"itemsSet":[["myaddon:mythril",1]]}}'),
      field('advanced', 'reforge/upgrade/ascendCostMods (JSON, optional)', TextInputStyle.Paragraph, false, '{"ascendCostMods":{"mythic":{"xpLevelsMul":2}}}'),
    ]
    : [
      field('type', 'Item type / group name (e.g. katana)', TextInputStyle.Short, true, 'katana'),
      field('match', 'Detection substrings (comma-separated)', TextInputStyle.Short, true, 'katana, _katana'),
    ];

  modal.addComponents(...rows.map((c) => new ActionRowBuilder().addComponents(c)));
  return interaction.showModal(modal);
}

function field(id, label, style, required, placeholder) {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required);
  if (placeholder) t.setPlaceholder(placeholder.slice(0, 100));
  return t;
}

export async function handleRrsModal(interaction) {
  const [, kindCode, mode] = interaction.customId.split('|');
  const isMaterial = kindCode === 'mat';

  // Re-check the gate on submit for the "register" (approved) path.
  if (mode === 'approved' && !isAddonMaintainer(interaction.member)) {
    return interaction.reply({ ephemeral: true, content: `Only **@${MAINTAINER_ROLE}** can register directly.` });
  }

  let kind; let key; let data; let vres;
  if (isMaterial) {
    const parsed = parseMaterialModal(interaction);
    if (parsed.error) return interaction.reply({ ephemeral: true, content: `❌ ${parsed.error}` });
    vres = validateMaterial(parsed.value);
    if (vres.error) return interaction.reply({ ephemeral: true, content: `❌ ${vres.error}` });
    kind = 'material'; key = parsed.value.material; data = parsed.value;
  } else {
    const type = interaction.fields.getTextInputValue('type').trim();
    const match = interaction.fields.getTextInputValue('match').split(',').map((s) => s.trim()).filter(Boolean);
    vres = validateItemType({ type, match });
    if (vres.error) return interaction.reply({ ephemeral: true, content: `❌ ${vres.error}` });
    kind = 'itemType'; key = type; data = vres.value;
  }

  const gid = interaction.guild.id;
  const userId = interaction.user.id;
  const warn = vres.warnings ? `\n⚠ ${vres.warnings}` : '';

  if (mode === 'approved') {
    const row = await rrsRegister(gid, { kind, key, data, userId });
    return interaction.reply({ ephemeral: true, content: `✅ Registered **${kind}** \`${key}\` (id ${row.id}, approved).${warn}` });
  }
  const row = await rrsSuggest(gid, { kind, key, data, userId });
  if (!row) return interaction.reply({ ephemeral: true, content: `A ${kind} named \`${key}\` already exists — ask a maintainer to update it.` });
  return interaction.reply({ ephemeral: true, content: `📥 Suggested **${kind}** \`${key}\` (id ${row.id}) — pending maintainer approval.${warn}` });
}

function parseMaterialModal(interaction) {
  const f = interaction.fields;
  const material = f.getTextInputValue('material').trim();
  const maxRaw = f.getTextInputValue('maxRarity').trim();
  const maxRarity = /^\d+$/.test(maxRaw) ? Number(maxRaw) : maxRaw;
  const obj = { material, maxRarity };
  try {
    obj.rarityWeightMods = JSON.parse(f.getTextInputValue('weights'));
    const costMods = f.getTextInputValue('costMods')?.trim();
    if (costMods) obj.costMods = JSON.parse(costMods);
    const advanced = f.getTextInputValue('advanced')?.trim();
    if (advanced) Object.assign(obj, JSON.parse(advanced));
  } catch (e) {
    return { error: `Invalid JSON: ${e.message}` };
  }
  return { value: obj };
}

// --- Maintainer actions ------------------------------------------------------
async function approve(interaction) {
  const id = interaction.options.getInteger('id');
  const row = await rrsApprove(interaction.guild.id, id, interaction.user.id);
  if (!row) return interaction.reply({ ephemeral: true, content: `No registration **#${id}** found.` });
  return interaction.reply({ ephemeral: true, content: `✅ Approved **${row.kind}** \`${row.reg_key}\` (#${id}).` });
}

async function remove(interaction) {
  const id = interaction.options.getInteger('id');
  const row = await rrsRemove(interaction.guild.id, id);
  if (!row) return interaction.reply({ ephemeral: true, content: `No registration **#${id}** found.` });
  return interaction.reply({ ephemeral: true, content: `🗑️ Removed **${row.kind}** \`${row.reg_key}\` (#${id}).` });
}

async function list(interaction) {
  const kind = interaction.options.getString('kind') ?? undefined;
  const statusOpt = interaction.options.getString('status');
  const approved = statusOpt ? statusOpt === 'approved' : undefined;
  const rows = await rrsList(interaction.guild.id, { kind, approved });
  if (!rows.length) return interaction.reply({ ephemeral: true, content: 'No registrations match.' });

  const lines = rows.slice(0, 40).map((r) => `\`#${r.id}\` ${r.approved ? '✅' : '🕓'} **${r.kind}** \`${r.reg_key}\``);
  const embed = new EmbedBuilder()
    .setTitle('🧬 Rarity & Stats registrations')
    .setDescription(lines.join('\n'))
    .setColor(0x9b59b6)
    .setFooter({ text: `${rows.length} shown · ✅ approved · 🕓 pending` });
  return interaction.reply({ ephemeral: true, embeds: [embed] });
}

async function generate(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const gid = interaction.guild.id;
  const materials = (await rrsList(gid, { kind: 'material', approved: true })).map((r) => r.data);
  const itemTypes = (await rrsList(gid, { kind: 'itemType', approved: true })).map((r) => r.data);
  if (!materials.length && !itemTypes.length) {
    return interaction.editReply('Nothing approved to bundle yet — approve some registrations first.');
  }

  const version = await rrsBumpVersion(gid, VERSION_MAJOR_MINOR);
  const buffer = await buildPackBuffer(materials, itemTypes, version);

  const { thread, error } = await resolveForumThread(interaction.guild);
  if (error) return interaction.editReply(error);

  const filename = `rarity-stats-support-v${version.join('.')}.mcaddon`;
  const embed = new EmbedBuilder()
    .setTitle(`🧬 Support Pack v${version.join('.')}`)
    .setDescription(`Load alongside Rarity & Stats.\n**${materials.length}** material(s) · **${itemTypes.length}** item type(s).`)
    .setColor(0x9b59b6)
    .setFooter({ text: `Generated by ${interaction.user.tag}` })
    .setTimestamp();
  await thread.send({ embeds: [embed], files: [{ attachment: buffer, name: filename }] });

  return interaction.editReply(`Generated **v${version.join('.')}** (${materials.length} materials, ${itemTypes.length} item types) → ${thread}`);
}

async function setforum(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { thread, error } = await resolveForumThread(interaction.guild);
  if (error) return interaction.editReply(error);
  return interaction.editReply(`Support-pack post is ${thread}. Future \`/rrs generate\` builds post there.`);
}
