-- New permission: view player inventories (granted to every default staff role except Support).
UPDATE roles SET permissions = array_append(permissions, 'players.inventory')
WHERE name IN ('Owner', 'Super Administrator', 'Administrator', 'Moderator')
  AND NOT ('players.inventory' = ANY(permissions));
