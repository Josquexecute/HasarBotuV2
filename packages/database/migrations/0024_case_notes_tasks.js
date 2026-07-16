/**
 * Paket 37 - vaka içi append-only notlar, optimistic görevler ve takip tarihi
 * geçmişi. Not/görev içerikleri merkezi audit'e kopyalanmaz.
 */
export const shorthands = undefined

export function up(pgm) {
  pgm.sql(`
    CREATE TABLE case_notes (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      note_type text NOT NULL,
      subject text,
      body text NOT NULL,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_notes_case_fk FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_notes_creator_fk FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_notes_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT case_notes_type_valid CHECK (note_type IN ('internal','contact')),
      CONSTRAINT case_notes_subject_valid CHECK (
        subject IS NULL OR (length(subject) BETWEEN 1 AND 160 AND subject ~ '[^[:space:]]' AND subject !~ '[[:cntrl:]]')
      ),
      CONSTRAINT case_notes_body_valid CHECK (
        length(body) BETWEEN 1 AND 5000 AND body ~ '[^[:space:]]'
      )
    );
    CREATE INDEX case_notes_case_created_idx
      ON case_notes(organization_id,case_id,created_at DESC,id DESC);

    CREATE TABLE case_tasks (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      title text NOT NULL,
      priority text NOT NULL DEFAULT 'normal',
      status text NOT NULL DEFAULT 'open',
      assigned_user_id uuid,
      due_date date NOT NULL,
      resolution_note text,
      resolved_by_user_id uuid,
      resolved_at timestamptz,
      version integer NOT NULL DEFAULT 1,
      created_by_user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_tasks_case_fk FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_tasks_assignee_fk FOREIGN KEY (organization_id,assigned_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_tasks_creator_fk FOREIGN KEY (organization_id,created_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_tasks_resolver_fk FOREIGN KEY (organization_id,resolved_by_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_tasks_tenant_id_unique UNIQUE (organization_id,case_id,id),
      CONSTRAINT case_tasks_title_valid CHECK (
        length(title) BETWEEN 1 AND 300 AND title ~ '[^[:space:]]' AND title !~ '[[:cntrl:]]'
      ),
      CONSTRAINT case_tasks_priority_valid CHECK (priority IN ('low','normal','high')),
      CONSTRAINT case_tasks_status_valid CHECK (status IN ('open','completed','cancelled')),
      CONSTRAINT case_tasks_resolution_valid CHECK (
        (status='open' AND resolution_note IS NULL AND resolved_by_user_id IS NULL AND resolved_at IS NULL)
        OR
        (status IN ('completed','cancelled') AND length(resolution_note) BETWEEN 1 AND 1000
          AND resolution_note ~ '[^[:space:]]' AND resolved_by_user_id IS NOT NULL AND resolved_at IS NOT NULL)
      ),
      CONSTRAINT case_tasks_version_valid CHECK (version>=1)
    );
    CREATE INDEX case_tasks_case_status_due_idx
      ON case_tasks(organization_id,case_id,status,due_date,id);
    CREATE INDEX case_tasks_org_open_due_idx
      ON case_tasks(organization_id,due_date,case_id) WHERE status='open';

    CREATE TABLE case_task_events (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      task_id uuid NOT NULL,
      event_type text NOT NULL,
      task_version integer NOT NULL,
      actor_user_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_task_events_task_fk FOREIGN KEY (organization_id,case_id,task_id)
        REFERENCES case_tasks(organization_id,case_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_task_events_actor_fk FOREIGN KEY (organization_id,actor_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_task_events_type_valid CHECK (event_type IN ('created','completed','cancelled')),
      CONSTRAINT case_task_events_version_valid CHECK (task_version>=1),
      CONSTRAINT case_task_events_version_unique UNIQUE (task_id,task_version)
    );
    CREATE INDEX case_task_events_case_idx
      ON case_task_events(organization_id,case_id,occurred_at DESC,id DESC);

    CREATE TABLE case_follow_up_history (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      case_id uuid NOT NULL,
      previous_follow_up_date date,
      new_follow_up_date date,
      source text NOT NULL,
      case_version integer NOT NULL,
      actor_user_id uuid NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_follow_up_history_case_fk FOREIGN KEY (organization_id,case_id)
        REFERENCES cases(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_follow_up_history_actor_fk FOREIGN KEY (organization_id,actor_user_id)
        REFERENCES users(organization_id,id) ON DELETE RESTRICT,
      CONSTRAINT case_follow_up_history_source_valid CHECK (source IN ('case_create','case_update')),
      CONSTRAINT case_follow_up_history_change_valid CHECK (
        previous_follow_up_date IS DISTINCT FROM new_follow_up_date
      ),
      CONSTRAINT case_follow_up_history_version_valid CHECK (case_version>=1),
      CONSTRAINT case_follow_up_history_version_unique UNIQUE (case_id,case_version)
    );
    CREATE INDEX case_follow_up_history_case_idx
      ON case_follow_up_history(organization_id,case_id,changed_at DESC,id DESC);

    CREATE FUNCTION case_note_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'case note is append-only' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER case_note_append_guard BEFORE UPDATE OR DELETE ON case_notes
      FOR EACH ROW EXECUTE FUNCTION case_note_append_guard();

    CREATE FUNCTION case_task_event_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'case task event is append-only' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER case_task_event_append_guard BEFORE UPDATE OR DELETE ON case_task_events
      FOR EACH ROW EXECUTE FUNCTION case_task_event_append_guard();

    CREATE FUNCTION case_follow_up_append_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'case follow-up history is append-only' USING ERRCODE='restrict_violation';
    END $$;
    CREATE TRIGGER case_follow_up_append_guard BEFORE UPDATE OR DELETE ON case_follow_up_history
      FOR EACH ROW EXECUTE FUNCTION case_follow_up_append_guard();

    CREATE FUNCTION case_task_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'case task cannot be deleted' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.organization_id<>NEW.organization_id OR OLD.case_id<>NEW.case_id OR OLD.created_by_user_id<>NEW.created_by_user_id
        OR OLD.created_at<>NEW.created_at OR OLD.title<>NEW.title OR OLD.priority<>NEW.priority
        OR OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id OR OLD.due_date<>NEW.due_date THEN
        RAISE EXCEPTION 'case task identity is immutable' USING ERRCODE='restrict_violation';
      END IF;
      IF OLD.status<>'open' OR NEW.status NOT IN ('completed','cancelled') THEN
        RAISE EXCEPTION 'invalid case task transition' USING ERRCODE='check_violation';
      END IF;
      IF NEW.version<>OLD.version+1 THEN
        RAISE EXCEPTION 'case task version must increment once' USING ERRCODE='check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER case_task_transition_guard BEFORE UPDATE OR DELETE ON case_tasks
      FOR EACH ROW EXECUTE FUNCTION case_task_transition_guard();
  `)
}

export function down(pgm) {
  pgm.sql(`
    DROP TRIGGER case_task_transition_guard ON case_tasks;
    DROP FUNCTION case_task_transition_guard();
    DROP TRIGGER case_follow_up_append_guard ON case_follow_up_history;
    DROP FUNCTION case_follow_up_append_guard();
    DROP TRIGGER case_task_event_append_guard ON case_task_events;
    DROP FUNCTION case_task_event_append_guard();
    DROP TRIGGER case_note_append_guard ON case_notes;
    DROP FUNCTION case_note_append_guard();
    DROP TABLE case_follow_up_history;
    DROP TABLE case_task_events;
    DROP TABLE case_tasks;
    DROP TABLE case_notes;
  `)
}
