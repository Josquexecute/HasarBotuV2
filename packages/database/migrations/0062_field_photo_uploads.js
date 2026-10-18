export const shorthands = undefined
export function up(pgm) {
  pgm.sql(`CREATE TABLE field_photo_uploads (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id),
    case_id uuid NOT NULL,
    uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
    client_key uuid NOT NULL,
    kind text NOT NULL CHECK(kind IN ('damage','chassis','odometer')),
    original_file_name text NOT NULL,
    byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 41943040),
    content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
    received_bytes integer NOT NULL DEFAULT 0 CHECK(received_bytes>=0 AND received_bytes<=byte_size),
    status text NOT NULL DEFAULT 'receiving' CHECK(status IN ('receiving','queued','processing','ready','failed')),
    storage_root_key text NOT NULL,
    relative_path text NOT NULL,
    location_version integer NOT NULL,
    leased_by_agent_id uuid REFERENCES agents(id),
    lease_token uuid,
    lease_expires_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    output_file_name text,
    output_bytes integer,
    output_hash text,
    output_width integer,
    output_height integer,
    photo_id uuid REFERENCES photos(id),
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(organization_id,uploaded_by_user_id,client_key),
    FOREIGN KEY(organization_id,case_id) REFERENCES cases(organization_id,id)
  );
  CREATE INDEX field_photo_uploads_case_idx ON field_photo_uploads(organization_id,case_id,created_at);
  CREATE INDEX field_photo_uploads_queue_idx ON field_photo_uploads(status,next_attempt_at);
  `)
}
export function down(pgm) { pgm.dropTable('field_photo_uploads') }
