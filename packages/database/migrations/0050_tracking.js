export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE google_identities (
      subject text PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE google_oauth_states (
      state_hash text PRIMARY KEY, browser_hash text NOT NULL,
      purpose text NOT NULL CHECK (purpose IN ('login','mail')),
      user_id uuid REFERENCES users(id), nonce text NOT NULL, verifier text NOT NULL,
      expires_at timestamptz NOT NULL, claimed_at timestamptz,
      completed_user_id uuid REFERENCES users(id), completed_at timestamptz, error_code text
    );
    CREATE TABLE mail_connections (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
      connected_by uuid NOT NULL REFERENCES users(id), subject text NOT NULL,
      email text NOT NULL, encrypted_refresh_token text,
      status text NOT NULL CHECK (status IN ('connected','disconnected','permission_required','error')),
      last_success_at timestamptz, last_error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id,subject)
    );
    CREATE TABLE tramer_requests (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
      case_id uuid NOT NULL REFERENCES cases(id), assigned_user_id uuid NOT NULL REFERENCES users(id),
      application_number text CHECK (application_number ~ '^[0-9]{1,128}$'),
      status text NOT NULL DEFAULT 'entry_pending'
        CHECK (status IN ('entry_pending','result_pending','completed','cancelled')),
      result_text text, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (organization_id, application_number),
      CHECK (status NOT IN ('result_pending','completed') OR application_number IS NOT NULL)
    );
    CREATE UNIQUE INDEX tramer_one_active_case ON tramer_requests(case_id)
      WHERE status IN ('entry_pending','result_pending');
    CREATE INDEX tramer_pending_assignee ON tramer_requests(organization_id,assigned_user_id,status);
    CREATE TABLE tracked_files (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
      case_id uuid NOT NULL REFERENCES cases(id), storage_root_key text NOT NULL,
      relative_path text NOT NULL, current_hash text NOT NULL, revision integer NOT NULL, available boolean NOT NULL DEFAULT true,
      UNIQUE (organization_id,case_id,storage_root_key,relative_path)
    );
    CREATE TABLE document_observations (
      id uuid PRIMARY KEY, file_id uuid NOT NULL REFERENCES tracked_files(id),
      revision integer NOT NULL, content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
      byte_size bigint NOT NULL CHECK (byte_size > 0), file_name text NOT NULL,
      document_type text, status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','rejected')),
      reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_note text,
      observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(file_id,revision)
    );
    CREATE TABLE sbm_messages (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
      connection_id uuid NOT NULL REFERENCES mail_connections(id), provider_message_id text NOT NULL,
      application_number text, result_status text CHECK (result_status IN ('completed','cancelled')),
      result_text text, evidence_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('review','applied','duplicate','dismissed')),
      reason text NOT NULL, tramer_id uuid REFERENCES tramer_requests(id),
      received_at timestamptz NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(),
      reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
      UNIQUE (connection_id,provider_message_id)
    );
    CREATE TABLE tracking_notifications (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
      case_id uuid NOT NULL REFERENCES cases(id), recipient_user_id uuid REFERENCES users(id),
      event_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('document','tramer')),
      title text NOT NULL, read_at timestamptz, presented_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,event_key)
    );
    CREATE INDEX tracking_notifications_inbox ON tracking_notifications(organization_id,recipient_user_id,created_at DESC);
    CREATE TABLE tracking_health (
      organization_id uuid NOT NULL REFERENCES organizations(id), kind text NOT NULL CHECK (kind IN ('folder','mail')),
      source_id text NOT NULL, last_attempt_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
      error_code text, PRIMARY KEY(organization_id,kind,source_id)
    );
    CREATE VIEW tracking_requirement_documents AS
      SELECT d.organization_id,d.case_id,v.id,d.document_type,
        CASE WHEN v.status='ready' AND EXISTS (SELECT 1 FROM tracking_health h WHERE h.organization_id=d.organization_id AND h.kind='folder')
          THEN 'pending' ELSE v.status END AS status,v.hash_verified,v.size_verified,v.verified_at
      FROM documents d JOIN document_versions v ON v.id=d.current_version_id
      WHERE NOT EXISTS (SELECT 1 FROM tracked_files f WHERE f.organization_id=d.organization_id
        AND f.case_id=d.case_id AND f.storage_root_key=v.storage_root_key AND f.relative_path=v.relative_path)
      UNION ALL
      SELECT f.organization_id,f.case_id,o.id,o.document_type,
        CASE o.status WHEN 'approved' THEN 'ready' WHEN 'rejected' THEN 'missing' ELSE 'pending' END,
        true,true,o.observed_at
      FROM tracked_files f JOIN document_observations o ON o.file_id=f.id AND o.revision=f.revision
      JOIN case_locations l ON l.organization_id=f.organization_id AND l.case_id=f.case_id
        AND l.storage_root_key=f.storage_root_key AND left(f.relative_path,length(l.relative_path)+1)=l.relative_path||'/'
      WHERE o.document_type IS NOT NULL AND f.available;
  `)
}

export function down(pgm) {
  pgm.sql('DROP VIEW tracking_requirement_documents')
  for (const table of ['tracking_health','tracking_notifications','sbm_messages','document_observations','tracked_files','tramer_requests','mail_connections','google_oauth_states','google_identities']) pgm.dropTable(table)
}
