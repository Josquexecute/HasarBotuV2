export const shorthands = undefined

export function up(pgm) {
  pgm.dropConstraint('document_text_extractions', 'document_text_extractions_engine_valid')
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_engine_valid', {
    check: "parser_name='pdfjs-dist' AND parser_version IN ('6.1.200','6.2.108') AND normalization_version='pdf-text-normalization/1.0.0' AND offset_unit='unicode_code_point'",
  })
}

export function down(pgm) {
  // Historical evidence must retain the version of the parser that produced it.
  pgm.sql("DO $$ BEGIN IF EXISTS(SELECT 1 FROM document_text_extractions WHERE parser_version='6.2.108') THEN RAISE EXCEPTION 'pdf_parser_version_downgrade_would_lose_data'; END IF; END $$")
  pgm.dropConstraint('document_text_extractions', 'document_text_extractions_engine_valid')
  pgm.addConstraint('document_text_extractions', 'document_text_extractions_engine_valid', {
    check: "parser_name='pdfjs-dist' AND parser_version='6.1.200' AND normalization_version='pdf-text-normalization/1.0.0' AND offset_unit='unicode_code_point'",
  })
}
