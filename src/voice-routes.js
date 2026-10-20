const snowflake = /^\d{15,22}$/;

/** Normalize CAD responses into one route per Discord voice channel. */
export function flattenVoiceRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  const flattened = [];
  const seen = new Set();
  for (const route of routes) {
    if (!route || !snowflake.test(String(route.guild_id || ''))) continue;
    const ids = Array.isArray(route.voice_channel_ids) ? route.voice_channel_ids : [route.voice_channel_id];
    for (const rawId of ids) {
      const channelId = String(rawId || '');
      if (!snowflake.test(channelId)) continue;
      const key = `${route.guild_id}:${channelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const normalized = {...route, voice_channel_id: channelId};
      delete normalized.voice_channel_ids;
      flattened.push(normalized);
    }
  }
  return flattened;
}

export const voiceRouteKey = (guildId, channelId) => `${guildId}:${channelId}`;
