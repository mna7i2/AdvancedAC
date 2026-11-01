UPDATE roles SET permissions = array_append(permissions, 'players.mods')
WHERE name IN ('Owner','Super Administrator','Administrator','Moderator') AND NOT ('players.mods' = ANY(permissions));
