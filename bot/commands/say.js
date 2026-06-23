// bot/commands/say.js
export async function handleSay(interaction, client) {
  const channel = interaction.options.getChannel("channel");
  const message = interaction.options.getString("message");

  try {
    await channel.send(message);
    await interaction.reply({ content: `Message sent in <#${channel.id}>.`, ephemeral: true });
  } catch (e) {
    await interaction.reply({ content: `Could not send message: ${e.message}`, ephemeral: true });
  }
}
