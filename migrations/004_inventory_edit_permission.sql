UPDATE roles SET permissions = array_append(permissions, 'players.inventory_edit')
WHERE name IN ('Owner','Super Administrator','Administrator') AND NOT ('players.inventory_edit' = ANY(permissions));
