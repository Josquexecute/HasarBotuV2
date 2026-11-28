function replaceRequirementsView(pgm, trackedStatus) {
  pgm.sql(`
    CREATE OR REPLACE VIEW tracking_requirement_documents AS
      SELECT d.organization_id,d.case_id,v.id,d.document_type,
        CASE WHEN v.status='ready' AND EXISTS (SELECT 1 FROM tracking_health h WHERE h.organization_id=d.organization_id AND h.kind='folder')
          THEN 'pending' ELSE v.status END AS status,v.hash_verified,v.size_verified,v.verified_at
      FROM documents d JOIN document_versions v ON v.id=d.current_version_id
      WHERE NOT EXISTS (SELECT 1 FROM tracked_files f WHERE f.organization_id=d.organization_id
        AND f.case_id=d.case_id AND f.storage_root_key=v.storage_root_key AND f.relative_path=v.relative_path)
      UNION ALL
      SELECT f.organization_id,f.case_id,o.id,o.document_type,${trackedStatus},true,true,o.observed_at
      FROM tracked_files f JOIN document_observations o ON o.file_id=f.id AND o.revision=f.revision
      JOIN case_locations l ON l.organization_id=f.organization_id AND l.case_id=f.case_id
        AND l.storage_root_key=f.storage_root_key AND left(f.relative_path,length(l.relative_path)+1)=l.relative_path||'/'
      WHERE o.document_type IS NOT NULL AND f.available
  `)
}

export function up(pgm) {
  pgm.addColumn('document_observations', { receipt_classified: { type: 'boolean', notNull: true, default: false } })
  pgm.sql(`
    CREATE FUNCTION tracked_document_requirement_status(candidate document_observations, current_hash text)
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT CASE
        WHEN candidate.status='rejected' THEN 'missing'
        WHEN candidate.content_hash<>current_hash THEN 'pending'
        WHEN candidate.status='approved' THEN 'ready'
        WHEN (SELECT past.status FROM document_observations past
              WHERE past.file_id=candidate.file_id AND past.content_hash=candidate.content_hash
                AND past.revision<candidate.revision AND past.status IN ('approved','rejected')
              ORDER BY past.revision DESC LIMIT 1)='rejected' THEN 'missing'
        WHEN candidate.receipt_classified OR candidate.revision=1 THEN 'ready'
        ELSE 'pending'
      END
    $$
  `)
  // Before this migration, replacement observations could inherit the type of different bytes.
  replaceRequirementsView(pgm, 'tracked_document_requirement_status(o, f.current_hash)')
}

export function down(pgm) {
  replaceRequirementsView(pgm, "CASE o.status WHEN 'approved' THEN 'ready' WHEN 'rejected' THEN 'missing' ELSE 'pending' END")
  pgm.sql('DROP FUNCTION tracked_document_requirement_status(document_observations, text)')
  pgm.dropColumn('document_observations', 'receipt_classified')
}
