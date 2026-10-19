interface AssistantFeedback {
  activity?(id: string, phase: 'start' | 'finish' | 'fail', message?: string): void
  taskCompleted?(): void
  notificationReceived?(): void
}

export function assistantFeedback(): AssistantFeedback | undefined {
  return (window as Window & { hasarbotuAssistantFeedback?: AssistantFeedback }).hasarbotuAssistantFeedback
}

/** Track the actual promise, including overlapping operations, without exposing case data. */
export async function withAssistantActivity<T>(operation: () => Promise<T>, failureMessage: string): Promise<T> {
  const feedback = assistantFeedback()
  if (!feedback?.activity) return operation()
  const id = crypto.randomUUID()
  feedback.activity(id, 'start')
  try {
    const result = await operation()
    feedback.activity(id, 'finish')
    return result
  } catch (error) {
    const cancelled = typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
    feedback.activity(id, cancelled ? 'finish' : 'fail', cancelled ? undefined : failureMessage)
    throw error
  }
}
