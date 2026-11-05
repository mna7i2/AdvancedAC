-- Lock a server's API key to the customer's server IP. ip_locked + allowed_ip NULL = bind to the first IP that connects.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS ip_locked boolean NOT NULL DEFAULT false;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS allowed_ip text;
