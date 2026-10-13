export const HOOK_EVENTS = [
  ['SessionStart', undefined],
  ['PostToolUse', 'Edit|Write|MultiEdit|NotebookEdit'],
]

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export function mergeHooks(settings, command) {
  if (!isObject(settings)) return null
  if (settings.hooks !== undefined && !isObject(settings.hooks)) return null

  const hooks = { ...settings.hooks }
  const ours = (hook) => isObject(hook) && hook.command === command

  for (const [event, matcher] of HOOK_EVENTS) {
    const groups = hooks[event] ?? []
    if (!Array.isArray(groups)) return null

    const present = groups.some((group) => isObject(group) && group.matcher === matcher && Array.isArray(group.hooks) && group.hooks.some(ours))
    if (present) continue

    const kept = groups.flatMap((group) => {
      if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(ours)) return [group]
      const rest = group.hooks.filter((hook) => !ours(hook))
      return rest.length > 0 ? [{ ...group, hooks: rest }] : []
    })
    const added = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 5 }] }
    hooks[event] = [...kept, added]
  }

  return { ...settings, hooks }
}
