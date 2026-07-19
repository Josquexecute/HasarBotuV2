/** Profiller organizasyon düzeyindedir; dosyaya değil Yönetim'e bağlıdır. */
export const LABOR_EXCEL_PROFILES_ROUTE = '/api/v1/labor-excel-profiles' as const
export const LABOR_EXCEL_PROFILE_ROUTE = '/api/v1/labor-excel-profiles/:profileId' as const

/**
 * Salt okunur projeksiyon. Dosyaya YAZMAZ; yalnız uygulanmış dağıtımın
 * seçilen profilin sütunlarına nasıl düşeceğini gösterir.
 */
export const LABOR_EXCEL_PROJECTION_ROUTE =
  '/api/v1/cases/:caseId/labor-allocation-applications/:applicationId/excel-projection' as const

export const LABOR_EXCEL_PROFILE_WRITE_SCOPE = 'labor-excel-profile:write' as const
