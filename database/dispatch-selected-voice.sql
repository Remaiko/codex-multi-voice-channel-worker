CREATE OR REPLACE FUNCTION public.midnight_discord_voice_claim_v4337(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare deliveries jsonb;
begin
 if p_key is null or length(p_key)<>64 or not exists(
   select 1 from midnight_discord.config c
   where c.key_hash=encode(extensions.digest(p_key,'sha256'),'hex')
 ) then raise exception 'INVALID_VOICE_BRIDGE_AUTH' using errcode='42501'; end if;

 insert into midnight_discord.voice_deliveries(event_id,guild_id,voice_channel_id,agency_code)
 select e.id,c.guild_id,ch.channel_id,midnight_discord.voice_department(c.guild_id,ch.channel_id)
 from midnight_discord.events e join midnight_discord.config c
   on c.enabled and c.voice_enabled and (cardinality(c.voice_channel_ids)>0 or c.voice_channel_id is not null)
 cross join lateral unnest(case when cardinality(c.voice_channel_ids)>0 then c.voice_channel_ids else array[c.voice_channel_id] end) ch(channel_id)
 where e.created_at>now()-interval '15 minutes'
   and coalesce((c.alert_rules->>e.kind)::boolean,true)
   and midnight_discord.voice_department_call(midnight_discord.voice_department(c.guild_id,ch.channel_id),e.call_id)
 on conflict(event_id,guild_id,voice_channel_id) do nothing;

 update midnight_discord.voice_deliveries set state='pending'
   where state='sending' and lease_until<now() and attempts<6;
 update midnight_discord.voice_deliveries set state='expired'
   where state='pending' and event_id in(select id from midnight_discord.events where created_at<now()-interval '15 minutes');
 update midnight_discord.voice_deliveries d set state='expired'
 from midnight_discord.config c
 where c.guild_id=d.guild_id and d.state='pending'
   and (not c.enabled or not c.voice_enabled or not d.voice_channel_id=any(
     case when cardinality(c.voice_channel_ids)>0 then c.voice_channel_ids else array[c.voice_channel_id] end));
 update midnight_discord.voice_deliveries d set state='expired' where d.state='pending' and d.agency_code is distinct from midnight_discord.voice_department(d.guild_id,d.voice_channel_id);
 with selected as (
   select d.id from midnight_discord.voice_deliveries d
   join midnight_discord.events e on e.id=d.event_id
   join midnight_discord.config c on c.guild_id=d.guild_id
   where d.state='pending' and d.next_attempt<=now() and d.attempts<6
     and c.enabled and c.voice_enabled and d.voice_channel_id=any(
       case when cardinality(c.voice_channel_ids)>0 then c.voice_channel_ids else array[c.voice_channel_id] end)
     and exists(select 1 from midnight_discord.links l
       join public.portal_dispatch_units u on u.user_id=l.user_id and u.on_duty and l.voice_alerts
       where l.guild_id=d.guild_id and public.portal_dispatch_is_responder(l.user_id)
         and midnight_discord.voice_department_member(d.agency_code,l.user_id))
   order by d.id limit 20 for update of d skip locked
 ), updated as (
   update midnight_discord.voice_deliveries d set state='sending',attempts=attempts+1,
     lease_until=now()+interval '2 minutes' from selected s where d.id=s.id returning d.*
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',d.id::text,'event_id',e.id::text,'call_id',e.call_id::text,'guild_id',d.guild_id,
   'voice_channel_id',d.voice_channel_id,'agency_code',d.agency_code,'templates',c.templates,
   'kind',e.kind,'payload',e.payload,'voice_id',(select automated_voice_id from midnight_audio_private.voice_settings_v435 where singleton),
   'authorized_user_ids',(select coalesce(jsonb_agg(l.discord_id),'[]'::jsonb)
     from midnight_discord.links l join public.portal_dispatch_units u on u.user_id=l.user_id and u.on_duty and l.voice_alerts
     where l.guild_id=d.guild_id and public.portal_dispatch_is_responder(l.user_id)
       and midnight_discord.voice_department_member(d.agency_code,l.user_id))
  ) order by d.id),'[]'::jsonb) into deliveries
 from updated d join midnight_discord.events e on e.id=d.event_id
 join midnight_discord.config c on c.guild_id=d.guild_id;
 return deliveries;
end $function$
;