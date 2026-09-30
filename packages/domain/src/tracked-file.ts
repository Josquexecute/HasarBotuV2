/** Office lock files and incomplete browser/copy downloads are never document events. */
export function isTemporaryTrackedFile(name: string): boolean {
  return /^(?:~\$|\.|~)|(?:\.tmp|\.temp|\.part|\.partial|\.crdownload|\.download|\.swp|\.lock|~)$/i.test(name)
    || /^(?:desktop\.ini|thumbs\.db)$/i.test(name)
}
