require("dotenv").config();
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// =====================
// PANEL CONFIG
// =====================
const PANEL_CONFIG_PATH = path.join(__dirname, "panel_config.json");

function loadPanelConfig() {
  if (!fs.existsSync(PANEL_CONFIG_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, "utf8")); } catch { return {}; }
}
function savePanelConfig(data) {
  fs.writeFileSync(PANEL_CONFIG_PATH, JSON.stringify(data, null, 2), "utf8");
}

const STARS = { 5: "⭐⭐⭐⭐⭐", 4: "⭐⭐⭐⭐", 3: "⭐⭐⭐", 2: "⭐⭐", 1: "⭐" };
const wizardSessions = new Map();

function buildPanelComponents(enabledStars) {
  const rows = []; let row = new ActionRowBuilder(); let count = 0;
  for (const [n, label] of Object.entries(STARS)) {
    if (!enabledStars.includes(Number(n))) continue;
    row.addComponents(new ButtonBuilder().setCustomId(`rate_${n}`).setLabel(label).setStyle(ButtonStyle.Secondary));
    count++;
    if (count % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
  }
  if (row.components.length > 0) rows.push(row);
  return rows;
}

function buildPanelEmbed(cfg) {
  const embed = new EmbedBuilder()
    .setColor(cfg.color || "#FFD700")
    .setTitle(cfg.title || "⭐ Évaluation")
    .setDescription(cfg.description || "Cliquez sur une étoile pour évaluer votre expérience !")
    .setTimestamp();
  if (cfg.footer) embed.setFooter({ text: cfg.footer });
  if (cfg.thumbnail) embed.setThumbnail(cfg.thumbnail);
  return embed;
}

async function sendWizardMain(interaction) {
  const session = wizardSessions.get(interaction.user.id);
  const d = session.data;
  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("⚙️ Configuration du Panel Avis")
    .addFields(
      { name: "Titre", value: d.title, inline: true },
      { name: "Couleur", value: d.color, inline: true },
      { name: "Boutons actifs", value: d.enabledStars.sort((a,b)=>b-a).map(n=>STARS[n]).join(" | "), inline: false },
      { name: "Salon d'avis", value: d.avisChannel ? `<#${d.avisChannel}>` : "Non défini", inline: true },
      { name: "Salon de logs", value: d.logChannel ? `<#${d.logChannel}>` : "Non défini", inline: true }
    );
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("wizard_embed").setLabel("✏️ Modifier l'embed").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("wizard_buttons").setLabel("⭐ Choisir les boutons").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("wizard_avischannel").setLabel("💬 Salon des avis").setStyle(ButtonStyle.Primary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("wizard_logchannel").setLabel("📋 Salon de logs").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("wizard_preview").setLabel("👁️ Aperçu").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("wizard_deploy").setLabel("🚀 Déployer").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("wizard_cancel").setLabel("❌ Annuler").setStyle(ButtonStyle.Danger)
  );
  const method = interaction.deferred || interaction.replied ? "editReply" : "reply";
  await interaction[method]({ embeds: [embed], components: [row1, row2], ephemeral: true });
}

// =====================
// READY
// =====================
client.once("ready", () => {
  console.log(`✅ ${client.user.tag} connecté`);
});

// =====================
// COMMANDE !panelconfig
// =====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!panelconfig")) return;
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply("❌ Tu n'as pas la permission `Gérer le serveur`.");
  }

  const existing = loadPanelConfig();
  const guildId = message.guild.id;
  const cfg = existing[guildId] || {};

  wizardSessions.set(message.author.id, {
    guildId,
    data: {
      title: cfg.title || "⭐ Évaluation",
      description: cfg.description || "Cliquez sur une étoile pour évaluer votre expérience !",
      footer: cfg.footer || "",
      color: cfg.color || "#FFD700",
      thumbnail: cfg.thumbnail || "",
      enabledStars: cfg.enabledStars || [5, 4, 3, 2, 1],
      avisChannel: cfg.avisChannel || null,
      logChannel: cfg.logChannel || null,
    },
  });

  const msg = await message.reply({ content: "⏳ Chargement..." });
  const pseudo = {
    user: message.author, guild: message.guild, channel: message.channel,
    deferred: false, replied: false,
    reply: async (opts) => { await msg.edit(opts); pseudo.replied = true; return msg; },
    editReply: async (opts) => { await msg.edit(opts); return msg; },
  };
  await sendWizardMain(pseudo);
});

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {

  // ── Boutons de vote ──
  if (interaction.isButton() && interaction.customId.startsWith("rate_")) {
    const stars = parseInt(interaction.customId.split("_")[1]);

    const modal = new ModalBuilder()
      .setCustomId(`modal_avis_${stars}`)
      .setTitle(`Votre avis — ${STARS[stars]}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("avis_texte")
          .setLabel("Écrivez votre avis")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Partagez votre expérience...")
          .setRequired(true)
          .setMaxLength(500)
      )
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Modal avis soumis ──
  if (interaction.isModalSubmit() && interaction.customId.startsWith("modal_avis_")) {
    const stars = parseInt(interaction.customId.split("_")[2]);
    const texte = interaction.fields.getTextInputValue("avis_texte");
    const config = loadPanelConfig();
    const guildCfg = config[interaction.guild.id] || {};

    await interaction.reply({ content: "✅ Merci pour votre avis !", ephemeral: true });

    const avisEmbed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("Nouvel avis")
      .setDescription(`**L'avis de ${interaction.user}** - ${STARS[stars]}\n\n*"${texte}"*`)
      .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }))
      .setTimestamp();

    // Envoyer dans le salon d'avis
    if (guildCfg.avisChannel) {
      const avisCh = interaction.guild.channels.cache.get(guildCfg.avisChannel);
      if (avisCh) await avisCh.send({ embeds: [avisEmbed] });
    }

    // Envoyer dans le salon de logs
    if (guildCfg.logChannel) {
      const logCh = interaction.guild.channels.cache.get(guildCfg.logChannel);
      if (logCh) {
        const logEmbed = new EmbedBuilder()
          .setColor("#5865F2")
          .setTitle("📋 Log — Nouvel avis")
          .addFields(
            { name: "Utilisateur", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
            { name: "Note", value: STARS[stars], inline: true },
            { name: "Avis", value: texte }
          )
          .setTimestamp();
        await logCh.send({ embeds: [logEmbed] });
      }
    }
    return;
  }

  // ── Wizard boutons ──
  if (interaction.isButton()) {
    const id = interaction.customId;
    const session = wizardSessions.get(interaction.user.id);

    if (id === "wizard_embed") {
      const modal = new ModalBuilder().setCustomId("modal_embed").setTitle("Modifier l'embed");
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_title").setLabel("Titre").setStyle(TextInputStyle.Short).setValue(session?.data.title||"").setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setValue(session?.data.description||"").setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_footer").setLabel("Footer").setStyle(TextInputStyle.Short).setValue(session?.data.footer||"").setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("embed_color").setLabel("Couleur hex (ex: #FFD700)").setStyle(TextInputStyle.Short).setValue(session?.data.color||"#FFD700").setRequired(false))
      );
      await interaction.showModal(modal);
      return;
    }

    if (id === "wizard_buttons") {
      const currentEnabled = session?.data.enabledStars || [5,4,3,2,1];
      const select = new StringSelectMenuBuilder()
        .setCustomId("select_stars").setPlaceholder("Boutons à afficher").setMinValues(1).setMaxValues(5)
        .addOptions(Object.entries(STARS).map(([n, label]) =>
          new StringSelectMenuOptionBuilder().setLabel(label).setValue(n).setDefault(currentEnabled.includes(Number(n)))
        ));
      await interaction.reply({ content: "⭐ Sélectionne les boutons à activer :", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
      return;
    }

    if (id === "wizard_avischannel") {
      const modal = new ModalBuilder().setCustomId("modal_avischannel").setTitle("Salon des avis");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("avis_channel_id").setLabel("ID du salon où poster les avis").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 123456789012345678").setValue(session?.data.avisChannel||"").setRequired(false)
      ));
      await interaction.showModal(modal);
      return;
    }

    if (id === "wizard_logchannel") {
      const modal = new ModalBuilder().setCustomId("modal_logchannel").setTitle("Salon de logs");
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("log_channel_id").setLabel("ID du salon de logs").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 123456789012345678").setValue(session?.data.logChannel||"").setRequired(false)
      ));
      await interaction.showModal(modal);
      return;
    }

    if (id === "wizard_preview") {
      if (!session) return interaction.reply({ content: "❌ Session expirée.", ephemeral: true });
      await interaction.reply({ content: "👁️ **Aperçu :**", embeds: [buildPanelEmbed(session.data)], components: buildPanelComponents(session.data.enabledStars), ephemeral: true });
      return;
    }

    if (id === "wizard_deploy") {
      if (!session) return interaction.reply({ content: "❌ Session expirée.", ephemeral: true });
      const allConfigs = loadPanelConfig();
      allConfigs[session.guildId] = session.data;
      savePanelConfig(allConfigs);
      await interaction.channel.send({ embeds: [buildPanelEmbed(session.data)], components: buildPanelComponents(session.data.enabledStars) });
      wizardSessions.delete(interaction.user.id);
      await interaction.reply({ content: "✅ Panel déployé !", ephemeral: true });
      return;
    }

    if (id === "wizard_cancel") {
      wizardSessions.delete(interaction.user.id);
      await interaction.update({ content: "❌ Annulé.", embeds: [], components: [] });
      return;
    }
  }

  // ── Select menu boutons ──
  if (interaction.isStringSelectMenu() && interaction.customId === "select_stars") {
    const session = wizardSessions.get(interaction.user.id);
    if (!session) return interaction.reply({ content: "❌ Session expirée.", ephemeral: true });
    session.data.enabledStars = interaction.values.map(Number);
    await interaction.update({ content: `✅ Boutons : ${session.data.enabledStars.sort((a,b)=>b-a).map(n=>STARS[n]).join(" | ")}`, components: [] });
    return;
  }

  // ── Modals wizard ──
  if (interaction.isModalSubmit()) {
    const session = wizardSessions.get(interaction.user.id);

    if (interaction.customId === "modal_embed") {
      if (!session) return interaction.reply({ content: "❌ Session expirée.", ephemeral: true });
      session.data.title = interaction.fields.getTextInputValue("embed_title");
      session.data.description = interaction.fields.getTextInputValue("embed_description");
      session.data.footer = interaction.fields.getTextInputValue("embed_footer");
      const color = interaction.fields.getTextInputValue("embed_color");
      if (/^#[0-9A-Fa-f]{6}$/.test(color)) session.data.color = color;
      await interaction.deferUpdate().catch(()=>{});
      await sendWizardMain({ user: interaction.user, guild: interaction.guild, deferred: true, replied: false, editReply: (opts) => interaction.editReply(opts) });
      return;
    }

    if (interaction.customId === "modal_avischannel") {
      if (!session) return interaction.reply({ content: "❌ Session expirée.", ephemeral: true });
      const chId = interaction.fields.getTextInputValue("avis_channel_id").trim();
      if (chId) {
        const ch = interaction.guild.channels.cache.get(chId);
        if (!ch) return interaction.reply({ content: "❌ Salon introuvable.", ephemeral: true });
        session.data.avisChannel = chId;
      } else {
        session.data.avisChannel = null;
      }
      await interaction.deferUpdate().catch(()=>{});
      await sendWizardMain({ user: interaction.user, guild: interaction.guild, deferred: true, replied: false, editReply: (opts) => interaction.editReply(opts) });
      return;
    }

    if (interaction.customId === "modal_logchannel") {
      if (!session) return interaction.reply({ content: "❌ Session expirée.", ephemeral: true });
      const chId = interaction.fields.getTextInputValue("log_channel_id").trim();
      if (chId) {
        const ch = interaction.guild.channels.cache.get(chId);
        if (!ch) return interaction.reply({ content: "❌ Salon introuvable.", ephemeral: true });
        session.data.logChannel = chId;
      } else {
        session.data.logChannel = null;
      }
      await interaction.deferUpdate().catch(()=>{});
      await sendWizardMain({ user: interaction.user, guild: interaction.guild, deferred: true, replied: false, editReply: (opts) => interaction.editReply(opts) });
      return;
    }
  }
});

const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Bot en ligne"));
app.listen(3000);

client.login(process.env.TOKEN);
