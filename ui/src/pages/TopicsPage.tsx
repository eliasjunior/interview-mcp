import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Topic, TopicDetails, TopicLevel, TopicQuestionDetail } from '../api'

import { getTopicDetails, getTopicPlans, getTopics, getTopicLevel, updateTopicPlan } from '../api'
import type { TopicPlan, TopicPlanPriority } from '@mock-interview/shared'

const LEVEL_STORAGE_KEY = 'topics-level-snapshot'
const LEVEL_HIGHLIGHT_WINDOW_MS = 24 * 60 * 60 * 1000

// ── Level config ──────────────────────────────────────────────────────────────

// color = single source of truth used for dot, border, and left-border
const LEVEL_CONFIG: Record<0 | 1 | 2 | 3 | 4, {
  color: string
  bg: string
  text: string
  label: string
  desc: string
  semantic: string
}> = {
  0: { color: '#cbd5e1', bg: '#1f293760', text: '#e5e7eb', label: 'L0', desc: 'Spark', semantic: 'First exposure and recognition' },
  1: { color: '#2dd4bf', bg: '#0f3d3660', text: '#ccfbf1', label: 'L1', desc: 'Padawan', semantic: 'Assisted recall with guidance' },
  2: { color: '#3b82f6', bg: '#0d1a3a60', text: '#bfdbfe', label: 'L2', desc: 'Forge', semantic: 'Shaping structured answers' },
  3: { color: '#f97316', bg: '#31130460', text: '#fdba74', label: 'L3', desc: 'Ranger', semantic: 'Capable in full mock interviews' },
  4: { color: '#c084fc', bg: '#3b076460', text: '#f3e8ff', label: 'L4', desc: 'Jedi Master', semantic: 'Sustained real-interview readiness' },
}

function getLevelAppearance(level: keyof typeof LEVEL_CONFIG) {
  const cfg = LEVEL_CONFIG[level]
  return {
    color: cfg.color,
    badgeStyle: { background: cfg.bg, border: `1px solid ${cfg.color}`, color: cfg.text },
    cardBorderStyle: { borderLeft: `3px solid ${cfg.color}` },
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Dot({ color }: { color: string }) {
  return <span style={{ color, fontSize: '0.65rem', lineHeight: 1 }}>●</span>
}

function LevelBadge({ level }: { level: 0 | 1 | 2 | 3 | 4 }) {
  const cfg = LEVEL_CONFIG[level]
  const appearance = getLevelAppearance(level)
  return (
    <span
      className="topic-level-badge"
      style={appearance.badgeStyle}
    >
      <Dot color={appearance.color} /> {cfg.label} — {cfg.desc}
    </span>
  )
}

function LevelSkeleton() {
  return <span className="topic-level-skeleton" />
}

function ProgressPips({ current, required }: { current: number; required: number }) {
  return (
    <div className="topic-progress-pips" aria-hidden="true">
      {Array.from({ length: required }, (_, index) => (
        <span
          key={index}
          className={`topic-progress-pip ${index < current ? 'filled' : ''}`}
        />
      ))}
    </div>
  )
}

function LadderRungs({ currentLevel }: { currentLevel: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <div className="topic-rungs" aria-label="Topic progression ladder">
      {([0, 1, 2, 3, 4] as const).map((lvl) => {
        const state = lvl < currentLevel ? 'done' : lvl === currentLevel ? 'current' : 'locked'
        return (
          <div key={lvl} className={`topic-rung topic-rung-${state}`}>
            <span className="topic-rung-mark">{lvl < currentLevel ? '✓' : lvl === currentLevel ? '•' : '○'}</span>
            <span className="topic-rung-label">{LEVEL_CONFIG[lvl].label}</span>
          </div>
        )
      })}
    </div>
  )
}

function getProgressTitle(levelData: TopicLevel) {
  if (levelData.progress.variant === 'complete') return 'Interview ready'
  return `Progress to L${levelData.progress.targetLevel}`
}

function getAlmostThereCopy(levelData: TopicLevel) {
  if (!levelData.progress.almostThere) return null
  if (levelData.progress.variant === 'interview') {
    return `One strong interview unlocks ${LEVEL_CONFIG[levelData.progress.targetLevel].label}.`
  }
  return `One more pass unlocks ${LEVEL_CONFIG[levelData.progress.targetLevel].label}.`
}

function getNoProgressCopy(levelData: TopicLevel) {
  if (levelData.progress.almostThere || levelData.progress.variant === 'complete') return null
  if (!levelData.progress.attempted) return null

  if (levelData.status === 'dropped') {
    return levelData.reason
  }

  if (levelData.progress.current === 0) {
    return levelData.reason
  }

  return null
}

function getCompactCardNote(levelData: TopicLevel) {
  if (levelData.progress.almostThere) return getAlmostThereCopy(levelData)
  if (levelData.status === 'dropped') return 'Needs reinforcement before the next full round.'
  if (levelData.progress.variant === 'complete') return 'Interview ready.'
  return null
}

function getStoredLevels() {
  try {
    const raw = window.localStorage.getItem(LEVEL_STORAGE_KEY)
    if (!raw) return {} as Record<string, number>
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {} as Record<string, number>
  }
}

type TopicPriority = TopicPlanPriority
type TopicFilter = 'plan' | 'core' | 'almost-there' | 'needs-reinforcement' | 'all'

const PRIORITY_LABELS: Record<TopicPriority, string> = {
  core: 'Core',
  secondary: 'Secondary',
  optional: 'Optional',
}

const PRIORITY_ORDER: Record<TopicPriority, number> = {
  core: 0,
  secondary: 1,
  optional: 2,
}

const FILTER_LABELS: Record<TopicFilter, string> = {
  plan: 'Plan',
  core: 'Core',
  'almost-there': 'Almost there',
  'needs-reinforcement': 'Needs reinforcement',
  all: 'All',
}

function getPriority(priorityMap: Record<string, TopicPriority>, file: string): TopicPriority {
  return priorityMap[file] ?? 'secondary'
}

type TopicAction = {
  key: string
  label: string
  prompt: string
  helper: string
}

type TopicQuestionPickerState = {
  topicFile: string
  displayName: string
  loading: boolean
  error: string | null
  details: TopicDetails | null
}

function formatDifficultyLabel(value: string | null) {
  if (!value) return null
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function buildWeakSlicePrompt(topicName: string, question: TopicQuestionDetail) {
  const lines = [
    `I want a targeted hands-on exercise for one narrow weak area from the topic "${topicName}".`,
    '',
    'Weak slice:',
    `"${question.text}"`,
    '',
    'Please use the available interview-mcp tools to turn this into a concrete exercise.',
    '- Prefer create_exercise.',
    '- Do not simply repeat the original interview question back to me.',
    '- Convert the weak slice into a practical implementation or design task with a realistic scenario, a clear problem statement, incremental steps, and evaluation criteria.',
    '- Keep the scope narrow and specific to this slice.',
    '- Only fall back to start_scoped_interview if this truly cannot be made into a meaningful exercise.',
    '- After creating the exercise, I may use start_scoped_interview later as a follow-up verbal defense.',
  ]

  if (question.exercise.fit !== 'none') {
    lines.push('', 'Authored exercise guidance:')
    lines.push(`- Exercise fit: ${question.exercise.fit}`)
    if (question.exercise.owner) lines.push(`- Exercise owner: ${question.exercise.owner}`)
    if (question.exercise.goal) lines.push(`- Exercise goal: ${question.exercise.goal}`)
    if (question.exercise.scope) lines.push(`- Exercise scope: ${question.exercise.scope}`)
    if (question.exercise.constraints?.length) {
      lines.push('- Exercise constraints:')
      lines.push(...question.exercise.constraints.map((item) => `  - ${item}`))
    }
    if (question.exercise.acceptance?.length) {
      lines.push('- Exercise acceptance:')
      lines.push(...question.exercise.acceptance.map((item) => `  - ${item}`))
    }
    if (question.exercise.seed) lines.push(`- Exercise seed: ${question.exercise.seed}`)
    lines.push('- Use this authored guidance as the primary input for shaping the exercise.')
  }

  return lines.join('\n')
}

function formatWeakSliceText(text: string) {
  return text
    .replace(/```(\w+)?\s*([\s\S]*?)\s*```/g, (_match, lang: string | undefined, code: string) => `\n\n\`\`\`${lang ?? ''}\n${code.trim()}\n\`\`\`\n\n`)
    .replace(/\s+(Evaluation criteria:|Strong answer:|Weak answer:|Model answer:|Hint:|Follow-up:)\s*/g, '\n\n$1\n')
    .replace(/\s+-\s+/g, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getRecommendedAction(levelData: TopicLevel, topicFile: string): TopicAction {
  if (levelData.status === 'dropped') {
    return {
      key: 'warmup-reset',
      label: 'Warm-up reinforcement',
      prompt: `Start a warm-up interview for "${topicFile}" at the recommended level.`,
      helper: 'Recover the ladder after a weak full interview.',
    }
  }

  if (levelData.level >= 3 || levelData.progress.variant === 'interview') {
    return {
      key: 'full',
      label: 'Full interview',
      prompt: `Start a mock interview for "${topicFile}".`,
      helper: 'Push the topic forward with a full round.',
    }
  }

  return {
    key: 'warmup',
    label: 'Warm-up',
    prompt: `Start a warm-up interview for "${topicFile}".`,
    helper: 'Best next move for the current ladder state.',
  }
}

function getTopicActions(levelData: TopicLevel, topicFile: string, displayName: string): TopicAction[] {
  const recommended = getRecommendedAction(levelData, topicFile)
  const actions: TopicAction[] = [
    recommended,
    {
      key: 'drill',
      label: 'Drill weak spots',
      prompt: `Drill me on weak spots for "${displayName}".`,
      helper: 'Good after at least one completed interview.',
    },
    {
      key: 'flashcards',
      label: 'Review flashcards',
      prompt: `Review my due flashcards for "${displayName}".`,
      helper: 'Quick recall round for weak answers.',
    },
    {
      key: 'copy',
      label: 'Copy topic prompt',
      prompt: `Start a mock interview for "${topicFile}".`,
      helper: 'Plain prompt for the current topic slug.',
    },
  ]

  return actions.filter((action, index, arr) => arr.findIndex((candidate) => candidate.key === action.key) === index)
}

function TopicActionLauncher({
  topicFile,
  displayName,
  levelData,
  activeMenu,
  setActiveMenu,
  handleCopyPrompt,
  compact = false,
}: {
  topicFile: string
  displayName: string
  levelData: TopicLevel
  activeMenu: string | null
  setActiveMenu: Dispatch<SetStateAction<string | null>>
  handleCopyPrompt: (topicFile: string, action: TopicAction) => void | Promise<void>
  compact?: boolean
}) {
  const actions = getTopicActions(levelData, topicFile, displayName)

  return (
    <div className={`topic-action-anchor ${compact ? 'compact' : ''}`}>
      <button
        className={`topic-file-button ${compact ? 'compact' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          setActiveMenu(prev => (prev === topicFile ? null : topicFile))
        }}
      >
        New Round
      </button>
      {activeMenu === topicFile && (
        <div className="topic-action-menu topic-action-menu-left" onClick={(event) => event.stopPropagation()}>
          <div className="topic-action-menu-title">Suggested commands</div>
          <code className="topic-action-topic">{topicFile}</code>
          {actions.map((action, index) => (
            <button
              key={action.key}
              className={`topic-action-item ${index === 0 ? 'recommended' : ''}`}
              onClick={() => handleCopyPrompt(topicFile, action)}
            >
              <div className="topic-action-row">
                <span className="topic-action-label">{action.label}</span>
                {index === 0 && <span className="topic-action-badge">Recommended</span>}
              </div>
              <div className="topic-action-helper">{action.helper}</div>
              <code className="topic-action-prompt">{action.prompt}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TopicQuestionPickerModal({
  state,
  onClose,
  onCopy,
}: {
  state: TopicQuestionPickerState
  onClose: () => void
  onCopy: (question: TopicQuestionDetail) => void | Promise<void>
}) {
  return (
    <div className="graph-modal-backdrop" onClick={onClose}>
      <div className="custom-interview-modal weak-slice-modal" onClick={(event) => event.stopPropagation()}>
        <div className="graph-modal-header">
          <div>
            <h2 className="topics-plan-title">Choose Weak Slice</h2>
            <p className="topics-plan-subtitle">Pick one authored question from this topic and copy a prompt the LLM can use to choose the right interview-mcp tool.</p>
          </div>
          <button className="btn-back" onClick={onClose}>✕ Close</button>
        </div>

        <div className="weak-slice-header">
          <div className="weak-slice-topic">{state.displayName}</div>
          {state.details?.summary && (
            <p className="weak-slice-summary">{state.details.summary}</p>
          )}
        </div>

        {state.loading && <div className="page-loading">Loading questions...</div>}
        {state.error && <div className="error-msg">{state.error}</div>}

        {!state.loading && !state.error && state.details && (
          <div className="weak-slice-list">
            {state.details.questions.map((question) => (
              <div key={question.index} className="weak-slice-item">
                <div className="weak-slice-item-main">
                  <div className="weak-slice-item-top">
                    <span className="weak-slice-index">Q{question.index + 1}</span>
                    {formatDifficultyLabel(question.difficulty) && (
                      <span className={`weak-slice-difficulty difficulty-${question.difficulty}`}>
                        {formatDifficultyLabel(question.difficulty)}
                      </span>
                    )}
                  </div>
                  <div className="weak-slice-question">{formatWeakSliceText(question.text)}</div>
                </div>
                {question.exercise.fit !== 'none' && (
                  <button
                    className="btn-secondary weak-slice-copy-btn"
                    onClick={() => onCopy(question)}
                  >
                    Copy exercise prompt
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TopicsPage() {
  const navigate = useNavigate()
  const [topics, setTopics] = useState<Topic[]>([])
  const [levels, setLevels] = useState<Record<string, TopicLevel>>({})
  const [topicPlans, setTopicPlans] = useState<Record<string, TopicPlan>>({})
  const [celebrating, setCelebrating] = useState<Record<string, true>>({})
  const [toastQueue, setToastQueue] = useState<Array<{ id: string; message: string; level: 0 | 1 | 2 | 3 | 4 }>>([])
  const [activeToast, setActiveToast] = useState<{ id: string; message: string; level: 0 | 1 | 2 | 3 | 4 } | null>(null)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [focusMap, setFocusMap] = useState<Record<string, boolean>>({})
  const [priorityMap, setPriorityMap] = useState<Record<string, TopicPriority>>({})
  const [activeFilter, setActiveFilter] = useState<TopicFilter>('all')
  const [topicQuestionPicker, setTopicQuestionPicker] = useState<TopicQuestionPickerState | null>(null)
  const [loading, setLoading] = useState(true)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const refreshInFlightRef = useRef(false)

  useEffect(() => {
    const storedLevels = getStoredLevels()

    async function refreshTopics(showLoading = false) {
      if (refreshInFlightRef.current) return
      refreshInFlightRef.current = true
      if (showLoading) setLoading(true)

      try {
        const [data, plans] = await Promise.all([getTopics(), getTopicPlans()])
        setTopics(data)
        setTopicPlans(Object.fromEntries(plans.map((plan) => [plan.topic, plan])))
        setFocusMap(Object.fromEntries(plans.map((plan) => [plan.topic, plan.focused])))
        setPriorityMap(Object.fromEntries(plans.map((plan) => [plan.topic, plan.priority])))

        const entries = await Promise.all(
          data.map(async (t) => {
            try {
              const lvl = await getTopicLevel(t.displayName)
              return [t.file, lvl, t.displayName] as const
            } catch {
              return null
            }
          })
        )

        const nextLevels: Record<string, TopicLevel> = {}
        entries.forEach((entry) => {
          if (!entry) return
          const [file, lvl, displayName] = entry
          nextLevels[file] = lvl

          const previousLevel = storedLevels[file]
          if (typeof previousLevel === 'number' && lvl.level > previousLevel) {
            setCelebrating(prev => ({ ...prev, [file]: true }))
            setToastQueue(prev => [
              ...prev,
              {
                id: `${file}-${lvl.level}`,
                message: `${displayName} reached ${LEVEL_CONFIG[lvl.level].label}: ${LEVEL_CONFIG[lvl.level].desc}`,
                level: lvl.level,
              },
            ])
            window.setTimeout(() => {
              setCelebrating(prev => {
                const next = { ...prev }
                delete next[file]
                return next
              })
            }, 1800)
          }

          storedLevels[file] = lvl.level
        })

        setLevels(nextLevels)
        window.localStorage.setItem(LEVEL_STORAGE_KEY, JSON.stringify(storedLevels))
      } finally {
        setLoading(false)
        refreshInFlightRef.current = false
      }
    }

    refreshTopics(true)

    function handleFocus() {
      refreshTopics(false)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshTopics(false)
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (activeToast || toastQueue.length === 0) return
    const [nextToast, ...rest] = toastQueue
    setActiveToast(nextToast)
    setToastQueue(rest)
  }, [activeToast, toastQueue])

  useEffect(() => {
    if (!activeToast) return
    const timeoutId = window.setTimeout(() => setActiveToast(null), 3200)
    return () => window.clearTimeout(timeoutId)
  }, [activeToast])

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!pageRef.current?.contains(event.target as Node)) {
        setActiveMenu(null)
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [])

  async function handleCopyPrompt(topicFile: string, action: TopicAction) {
    let copied = false
    try {
      await navigator.clipboard.writeText(action.prompt)
      copied = true
    } catch {
      // fallback for browsers that block clipboard API without focus/HTTPS
      try {
        const textarea = document.createElement('textarea')
        textarea.value = action.prompt
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        copied = document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {
        // both methods failed
      }
    }

    if (copied) {
      setToastQueue(prev => [
        ...prev,
        {
          id: `${topicFile}-${action.key}-copied`,
          message: `Copied: ${action.label}`,
          level: 1,
        },
      ])
      setActiveMenu(null)
    } else {
      setToastQueue(prev => [
        ...prev,
        {
          id: `${topicFile}-${action.key}-failed`,
          message: `Could not copy the prompt for ${action.label}.`,
          level: 0,
        },
      ])
    }
  }

  async function handlePlanUpdate(topic: string, next: { focused: boolean; priority: TopicPriority }) {
    const previousFocused = focusMap[topic] ?? false
    const previousPriority = getPriority(priorityMap, topic)

    setFocusMap((prev) => ({ ...prev, [topic]: next.focused }))
    setPriorityMap((prev) => ({ ...prev, [topic]: next.priority }))

    try {
      const updated = await updateTopicPlan(topic, next)
      setTopicPlans((prev) => ({ ...prev, [topic]: updated }))
    } catch {
      setFocusMap((prev) => ({ ...prev, [topic]: previousFocused }))
      setPriorityMap((prev) => ({ ...prev, [topic]: previousPriority }))
      setToastQueue(prev => [
        ...prev,
        {
          id: `${topic}-plan-update-failed`,
          message: `Could not save plan changes for ${topic}.`,
          level: 0,
        },
      ])
    }
  }

  async function openTopicQuestionPicker(topic: Topic) {
    setTopicQuestionPicker({
      topicFile: topic.file,
      displayName: topic.displayName,
      loading: true,
      error: null,
      details: null,
    })

    try {
      const details = await getTopicDetails(topic.file)
      setTopicQuestionPicker({
        topicFile: topic.file,
        displayName: topic.displayName,
        loading: false,
        error: null,
        details,
      })
    } catch (error) {
      setTopicQuestionPicker({
        topicFile: topic.file,
        displayName: topic.displayName,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        details: null,
      })
    }
  }

  async function handleCopyWeakSlicePrompt(topicName: string, question: TopicQuestionDetail) {
    try {
      await navigator.clipboard.writeText(buildWeakSlicePrompt(topicName, question))
      setToastQueue(prev => [
        ...prev,
        {
          id: `${topicName}-weak-slice-${question.index}`,
          message: `Copied weak-slice prompt for ${topicName}.`,
          level: 1,
        },
      ])
    } catch {
      setToastQueue(prev => [
        ...prev,
        {
          id: `${topicName}-weak-slice-${question.index}-failed`,
          message: `Could not copy the weak-slice prompt for ${topicName}.`,
          level: 0,
        },
      ])
    }
  }

  if (loading) return <div className="page-loading">Loading...</div>

  const sortedTopics = [...topics].sort((a, b) => {
    const focusedA = focusMap[a.file] ? 0 : 1
    const focusedB = focusMap[b.file] ? 0 : 1
    if (focusedA !== focusedB) return focusedA - focusedB
    const priorityA = PRIORITY_ORDER[getPriority(priorityMap, a.file)]
    const priorityB = PRIORITY_ORDER[getPriority(priorityMap, b.file)]
    if (priorityA !== priorityB) return priorityA - priorityB
    const levelA = levels[a.file]?.level ?? Number.POSITIVE_INFINITY
    const levelB = levels[b.file]?.level ?? Number.POSITIVE_INFINITY
    if (levelA !== levelB) return levelA - levelB
    return a.displayName.localeCompare(b.displayName)
  })
  const plannedTopics = sortedTopics.filter((topic) => focusMap[topic.file])
  const now = Date.now()
  const visibleTopics = sortedTopics.filter((topic) => {
    const levelData = levels[topic.file]

    if (activeFilter === 'plan') return focusMap[topic.file]
    if (activeFilter === 'core') return getPriority(priorityMap, topic.file) === 'core'
    if (activeFilter === 'almost-there') return Boolean(levelData?.progress.almostThere)
    if (activeFilter === 'needs-reinforcement') return levelData?.status === 'dropped'
    return true
  })

  return (
    <div className="topics-page" ref={pageRef}>
      <div className="topics-header">
        <div>
          <h1 className="topics-title">Interview Topics</h1>
          <p className="topics-subtitle">
            Each topic has a progressive warm-up ladder before the full interview.
          </p>
        </div>
        <span className="topics-count">{topics.length} topics</span>
      </div>

      <div className="topics-level-legend">
        {([0, 1, 2, 3, 4] as const).map(lvl => {
          const cfg = LEVEL_CONFIG[lvl]
          const appearance = getLevelAppearance(lvl)
          return (
            <div key={lvl} className="legend-item">
              <div className="legend-badge" style={appearance.badgeStyle}>
                <Dot color={appearance.color} />
                <span className="legend-label">{cfg.label}</span>
                <span className="legend-desc">{cfg.desc}</span>
              </div>
              <span className="legend-semantic">{cfg.semantic}</span>
            </div>
          )
        })}
      </div>

      {plannedTopics.length > 0 && (
        <div className="topics-plan">
          <div className="topics-plan-header">
            <div>
              <h2 className="topics-plan-title">Interview Plan</h2>
              <p className="topics-plan-subtitle">Focus these topics first for your next rounds.</p>
            </div>
            <span className="topics-plan-count">{plannedTopics.length} focused</span>
          </div>
          <div className="topics-plan-list">
            {plannedTopics.map((topic) => {
              const levelData = levels[topic.file]
              const level = levelData?.level
              const recentLevelUp = topicPlans[topic.file]?.lastLevelUpAt
                ? now - new Date(topicPlans[topic.file].lastLevelUpAt!).getTime() < LEVEL_HIGHLIGHT_WINDOW_MS
                : false
              return (
                <div key={`plan-${topic.file}`} className={`topics-plan-item ${recentLevelUp ? 'topics-plan-item-recent-level-up' : ''}`}>
                  <div className="topics-plan-main">
                    <div className="topics-plan-title-row">
                      <div className="topics-plan-name">{topic.displayName}</div>
                      {level !== undefined && <LevelBadge level={level} />}
                    </div>
                    <div className="topics-plan-meta">
                      <button
                        className={`topic-focus-btn topics-plan-focus-btn ${focusMap[topic.file] ? 'active' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handlePlanUpdate(topic.file, {
                            focused: !focusMap[topic.file],
                            priority: getPriority(priorityMap, topic.file),
                          })
                        }}
                      >
                        {focusMap[topic.file] ? 'Unfocus' : 'Focus now'}
                      </button>
                      <span className={`topics-plan-priority priority-${getPriority(priorityMap, topic.file)}`}>
                        {PRIORITY_LABELS[getPriority(priorityMap, topic.file)]}
                      </span>
                      {level !== undefined && <span className="topics-plan-level">L{level}</span>}
                    </div>
                  </div>
                  {levelData && (
                    <div className="topics-plan-side">
                      {recentLevelUp && topicPlans[topic.file]?.lastUnlockedLevel !== undefined && (
                        <div className="topic-level-up-pill">
                          Recently reached L{topicPlans[topic.file].lastUnlockedLevel}
                        </div>
                      )}
                      <TopicActionLauncher
                        topicFile={topic.file}
                        displayName={topic.displayName}
                        levelData={levelData}
                        activeMenu={activeMenu}
                        setActiveMenu={setActiveMenu}
                        handleCopyPrompt={handleCopyPrompt}
                        compact
                      />
                      <button
                        className="topic-secondary-btn"
                        onClick={() => void openTopicQuestionPicker(topic)}
                      >
                        Weak Slice
                      </button>
                      <button
                        className="topic-secondary-btn"
                        onClick={() => navigate(`/arena?topic=${encodeURIComponent(topic.file)}`)}
                      >
                        Crisis Mode
                      </button>
                      {level !== undefined && <LadderRungs currentLevel={level} />}
                      <div className="topics-plan-progress-block">
                        <div className="topics-plan-progress-title">{getProgressTitle(levelData)}</div>
                        <ProgressPips
                          current={Math.min(levelData.progress.current, levelData.progress.required)}
                          required={levelData.progress.required}
                        />
                      </div>
                      <div className="topics-plan-hint">
                        {levelData.progress.label}
                      </div>
                      {getNoProgressCopy(levelData) && (
                        <div className="topics-plan-why">
                          {getNoProgressCopy(levelData)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="topics-filters">
        {(['plan', 'core', 'almost-there', 'needs-reinforcement', 'all'] as const).map((filter) => (
          <button
            key={filter}
            className={`topics-filter ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {FILTER_LABELS[filter]}
          </button>
        ))}
      </div>

      {(() => {
        const grouped = visibleTopics.reduce<Record<string, typeof visibleTopics>>((acc, topic) => {
          const cat = topic.category || 'other'
          if (!acc[cat]) acc[cat] = []
          acc[cat].push(topic)
          return acc
        }, {})
        const categoryOrder = Object.keys(grouped).sort()

        return categoryOrder.map((category) => (
          <div key={category} className="topics-category-group">
            <div className="topics-category-header">
              <span className="topics-category-label">{category.replace(/-/g, ' ')}</span>
              <span className="topics-category-count">{grouped[category].length}</span>
            </div>
            <div className="topics-list">
              {grouped[category].map(topic => {
                const levelData = levels[topic.file]
                const level = levelData?.level
                const appearance = level !== undefined ? getLevelAppearance(level) : null
                const recentLevelUp = topicPlans[topic.file]?.lastLevelUpAt
                  ? now - new Date(topicPlans[topic.file].lastLevelUpAt!).getTime() < LEVEL_HIGHLIGHT_WINDOW_MS
                  : false

                return (
                  <div
                    key={topic.file}
                    className={`topic-card ${celebrating[topic.file] ? 'topic-card-leveled-up' : ''} ${recentLevelUp ? 'topic-card-recent-level-up' : ''}`}
                    style={appearance ? appearance.cardBorderStyle : { borderLeft: '3px solid var(--line)' }}
                  >
                    <div className="topic-card-main">
                      <div className="topic-name">{topic.displayName}</div>
                      <div className="topic-file-row">
                        <div className="topic-planning-row">
                          <button
                            className={`topic-focus-btn ${focusMap[topic.file] ? 'active' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handlePlanUpdate(topic.file, {
                                focused: !focusMap[topic.file],
                                priority: getPriority(priorityMap, topic.file),
                              })
                            }}
                          >
                            {focusMap[topic.file] ? 'Unfocus' : 'Focus now'}
                          </button>
                          <div className="topic-priority-group">
                            {(['core', 'secondary', 'optional'] as const).map((priority) => (
                              <button
                                key={priority}
                                className={`topic-priority-btn ${getPriority(priorityMap, topic.file) === priority ? 'active' : ''}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handlePlanUpdate(topic.file, {
                                    focused: Boolean(focusMap[topic.file]),
                                    priority,
                                  })
                                }}
                              >
                                {PRIORITY_LABELS[priority]}
                              </button>
                            ))}
                          </div>
                          {levelData && (
                            <TopicActionLauncher
                              topicFile={topic.file}
                              displayName={topic.displayName}
                              levelData={levelData}
                              activeMenu={activeMenu}
                              setActiveMenu={setActiveMenu}
                              handleCopyPrompt={handleCopyPrompt}
                            />
                          )}
                          <button
                            className="topic-secondary-btn"
                            onClick={() => void openTopicQuestionPicker(topic)}
                          >
                            Weak Slice
                          </button>
                          <button
                            className="topic-secondary-btn"
                            onClick={() => navigate(`/arena?topic=${encodeURIComponent(topic.file)}`)}
                          >
                            Crisis Mode
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="topic-card-right">
                      {level !== undefined && levelData ? <LevelBadge level={level} /> : <LevelSkeleton />}
                      {recentLevelUp && topicPlans[topic.file]?.lastUnlockedLevel !== undefined && (
                        <div className="topic-level-up-pill">
                          Recently reached L{topicPlans[topic.file].lastUnlockedLevel}
                        </div>
                      )}
                      {levelData && level !== undefined && (
                        <div className="topic-progress">
                          <div className="topic-progress-header">
                            <span className="topic-progress-title">{getProgressTitle(levelData)}</span>
                            <span className="topic-progress-meta">{levelData.progress.label}</span>
                          </div>
                          <ProgressPips
                            current={Math.min(levelData.progress.current, levelData.progress.required)}
                            required={levelData.progress.required}
                          />
                          {getCompactCardNote(levelData) && (
                            <div className="topic-compact-note">
                              {getCompactCardNote(levelData)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      })()}

      {topics.length === 0 && (
        <div className="topics-empty">No knowledge files found.</div>
      )}
      {topics.length > 0 && visibleTopics.length === 0 && (
        <div className="topics-empty">No topics match the current filter.</div>
      )}

      {activeToast && (
        <div
          className="topic-level-toast"
          style={{ borderColor: LEVEL_CONFIG[activeToast.level].color, color: LEVEL_CONFIG[activeToast.level].text }}
        >
          {activeToast.message}
        </div>
      )}

      {topicQuestionPicker && (
        <TopicQuestionPickerModal
          state={topicQuestionPicker}
          onClose={() => setTopicQuestionPicker(null)}
          onCopy={(question) => void handleCopyWeakSlicePrompt(topicQuestionPicker.displayName, question)}
        />
      )}
    </div>
  )
}
