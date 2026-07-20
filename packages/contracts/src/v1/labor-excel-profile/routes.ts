/** Profiller organizasyon düzeyindedir; dosyaya değil Yönetim'e bağlıdır. */
export const LABOR_EXCEL_PROFILES_ROUTE = '/api/v1/labor-excel-profiles' as const
export const LABOR_EXCEL_PROFILE_ROUTE = '/api/v1/labor-excel-profiles/:profileId' as const

/**
 * Salt okunur projeksiyon. Dosyaya YAZMAZ; yalnız uygulanmış dağıtımın
 * seçilen profilin sütunlarına nasıl düşeceğini gösterir.
 */
export const LABOR_EXCEL_PROJECTION_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-applications/:applicationId/excel-projection' as const

/** P63: profili pasifleştirme/yeniden etkinleştirme. */
export const LABOR_EXCEL_PROFILE_STATUS_ROUTE =
  '/api/v1/labor-excel-profiles/:profileId/status' as const

/**
 * P63: dosya için seçilebilir profiller ve öneri. Gerçek Excel dosyası
 * OKUNMAZ; bu yalnız profil önerisidir.
 */
export const LABOR_EXCEL_PROFILE_CANDIDATES_ROUTE =
  '/api/v1/cases/:caseId/labor-excel-profile-candidates' as const

export const LABOR_EXCEL_PROFILE_WRITE_SCOPE = 'labor-excel-profile:write' as const
export const LABOR_EXCEL_PROFILE_STATUS_SCOPE = 'labor-excel-profile:status' as const
