export type QuotaWindow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type Handoff = {
  text: string
  at: number
  turns: number
  cwd: string
  // Conversación que lo escribió; falta en los guardados antes de la versión 3.2.
  sessionId?: string
  isConsumed: boolean
}

export type Guardian = {
  text: string
  coldMs: number
  tokens: number
  hasHandoff: boolean
  missedTurns: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-guardian': {
      lastEnd: number | null
      tokens: number
      isBusy: boolean
      turns: number
      tick: number
      quota: QuotaWindow[]
      handoff: Handoff | null
      isWriting: boolean
      isAttaching: boolean
      isTaskDone: boolean
      pending: Handoff | null
      guardian: Guardian | null
      windowSize: number
      modelName: string
      effortLevel: string
      quotaAt: number
      sessionKey: string
      owner: string
    }
  }
}
