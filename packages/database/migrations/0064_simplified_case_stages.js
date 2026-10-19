export function up(pgm) {
  // Legacy codes remain readable until each office deliberately migrates its business records.
  pgm.dropConstraint('cases', 'cases_stage_valid')
  pgm.addConstraint('cases', 'cases_stage_valid', {
    check: "workflow_stage IN ('new_notification','parts_and_labor','under_repair','under_investigation','total_loss','closed','vehicle_or_service_pending','inspection_pending','damage_assessment','repair_approval_pending','reporting','closing_documents','ready_to_close')",
  })
}

export function down(pgm) {
  pgm.sql("UPDATE cases SET workflow_stage='under_repair',version=version+1 WHERE workflow_stage IN ('under_investigation','total_loss')")
  pgm.dropConstraint('cases', 'cases_stage_valid')
  pgm.addConstraint('cases', 'cases_stage_valid', {
    check: "workflow_stage IN ('new_notification','parts_and_labor','under_repair','closed','vehicle_or_service_pending','inspection_pending','damage_assessment','repair_approval_pending','reporting','closing_documents','ready_to_close')",
  })
}
