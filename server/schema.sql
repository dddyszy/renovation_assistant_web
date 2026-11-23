CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 nickname text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_tokens (
 id text PRIMARY KEY, email text NOT NULL, purpose text NOT NULL,
 token_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS verification_email_idx ON verification_tokens(email, purpose);
CREATE TABLE IF NOT EXISTS families (
 id text PRIMARY KEY, name text NOT NULL, owner_user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS family_members (
 family_id text NOT NULL REFERENCES families(id), user_id text NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')), joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(family_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS family_one_owner ON family_members(family_id) WHERE role='owner';
CREATE TABLE IF NOT EXISTS invitations (
 id text PRIMARY KEY, family_id text NOT NULL REFERENCES families(id), token_hash text NOT NULL UNIQUE,
 role text NOT NULL CHECK (role IN ('admin','member','viewer')), invited_by text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, used_by text REFERENCES users(id), revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
 id text PRIMARY KEY, family_id text NOT NULL REFERENCES families(id), name text NOT NULL, address text NOT NULL DEFAULT '',
 description text NOT NULL DEFAULT '', package_type text NOT NULL CHECK (package_type IN ('half','full')),
 budget_cents bigint NOT NULL DEFAULT 0 CHECK (budget_cents BETWEEN 0 AND 999999999999),
 start_date text NOT NULL DEFAULT '', end_date text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
 template_id text NOT NULL DEFAULT 'blank', created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(id,family_id)
);
CREATE TABLE IF NOT EXISTS stages (
 id text PRIMARY KEY, family_id text NOT NULL, project_id text NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
 budget_cents bigint NOT NULL DEFAULT 0 CHECK (budget_cents BETWEEN 0 AND 999999999999), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
 created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(id,family_id,project_id), FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS materials (
 id text PRIMARY KEY, family_id text NOT NULL, project_id text NOT NULL, stage_id text,
 name text NOT NULL, category text NOT NULL DEFAULT '材料', quantity numeric NOT NULL DEFAULT 1 CHECK(quantity>=0), unit text NOT NULL DEFAULT '件',
 model text NOT NULL DEFAULT '', supplier text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '',
 total_price_cents bigint NOT NULL DEFAULT 0 CHECK (total_price_cents BETWEEN 0 AND 999999999999),
 purchase_status text NOT NULL DEFAULT 'planned' CHECK (purchase_status IN ('planned','ordered','purchased')),
 created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(id,family_id,project_id), FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE,
 FOREIGN KEY(stage_id,family_id,project_id) REFERENCES stages(id,family_id,project_id)
);
CREATE TABLE IF NOT EXISTS costs (
 id text PRIMARY KEY, family_id text NOT NULL, project_id text NOT NULL, stage_id text, material_id text,
 title text NOT NULL, category text NOT NULL DEFAULT '材料', amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 999999999999),
 payment_status text NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('paid','pending')), merchant text NOT NULL DEFAULT '',
 payment_method text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', incurred_at text NOT NULL,
 request_id text NOT NULL, request_fingerprint text NOT NULL,
 created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(family_id,project_id,created_by,request_id), FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE,
 FOREIGN KEY(stage_id,family_id,project_id) REFERENCES stages(id,family_id,project_id),
 FOREIGN KEY(material_id,family_id,project_id) REFERENCES materials(id,family_id,project_id)
);
CREATE INDEX IF NOT EXISTS costs_project_date ON costs(family_id,project_id,incurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS materials_project ON materials(family_id,project_id);
CREATE TABLE IF NOT EXISTS note_columns (
 id text PRIMARY KEY, family_id text NOT NULL, project_id text NOT NULL, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0,
 created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(id,family_id,project_id), FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notes (
 id text PRIMARY KEY, family_id text NOT NULL, project_id text NOT NULL, column_id text NOT NULL,
 title text NOT NULL, details jsonb NOT NULL DEFAULT '[]', starred boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
 created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE,
 FOREIGN KEY(column_id,family_id,project_id) REFERENCES note_columns(id,family_id,project_id)
);
CREATE TABLE IF NOT EXISTS note_images (
 id text PRIMARY KEY, note_id text NOT NULL, family_id text NOT NULL, project_id text NOT NULL,
 mime text NOT NULL, width integer NOT NULL DEFAULT 0, height integer NOT NULL DEFAULT 0,
 bytes bytea NOT NULL, sort_order integer NOT NULL DEFAULT 0,
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS note_images_note ON note_images(note_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS note_shares (
 id text PRIMARY KEY, note_id text NOT NULL, family_id text NOT NULL, project_id text NOT NULL,
 token_hash text NOT NULL UNIQUE, created_by text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,family_id) REFERENCES projects(id,family_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS note_shares_note ON note_shares(note_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS audit_logs (
 id text PRIMARY KEY, family_id text NOT NULL REFERENCES families(id), actor_user_id text NOT NULL REFERENCES users(id),
 action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_family ON audit_logs(family_id,created_at DESC);
CREATE TABLE IF NOT EXISTS user_preferences (
 user_id text PRIMARY KEY REFERENCES users(id), family_id text NOT NULL, project_id text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stage_active_name ON stages(project_id,name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS column_active_name ON note_columns(project_id,name) WHERE deleted_at IS NULL;
