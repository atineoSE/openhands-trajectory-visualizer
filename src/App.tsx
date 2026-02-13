import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, FileText, User, Bot, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

// Types
interface Trajectory {
  id: string
  title: string
  model: string | null
  created: string
  eventCount: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cachePct: number
  totalTokens: number
  avgAgentTurnTime: number
  totalConversationTime: number
}

interface Event {
  id: string
  source: string
  kind: string
  timestamp: string
  content?: unknown
  thought?: unknown
  action?: unknown
  observation?: unknown
  model?: string
  duration?: number
  error?: unknown
  // AgentStartEvent fields
  system_prompt?: unknown
  // LLM response fields
  llm_message?: unknown
  // Additional fields
  summary?: string
  tool_name?: string
}

interface ModelStats {
  model: string
  conversations: number
  avgTurnDuration: number
  maxTurnDuration: number
  totalPromptTokens: number
  totalCompletionTokens: number
}

// Get config from window
declare global {
  interface Window {
    TRAJECTORY_CONFIG?: {
      staticMode: boolean
      isCustomDir: boolean
      directoryName: string
    }
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M'
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K'
  return tokens.toString()
}

function formatTime(seconds: number): string {
  if (seconds >= 3600) return (seconds / 3600).toFixed(1) + 'h'
  if (seconds >= 60) return (seconds / 60).toFixed(1) + 'm'
  return seconds.toFixed(1) + 's'
}

function formatTimestamp(timestamp: string): { time: string; date: string } {
  try {
    const date = new Date(timestamp)
    return {
      time: date.toLocaleTimeString('en-US', { hour12: false }),
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  } catch {
    return { time: '', date: '' }
  }
}

function getEventIcon(source: string) {
  switch (source) {
    case 'system': return <FileText className="h-4 w-4" />
    case 'user': return <User className="h-4 w-4" />
    case 'agent': return <Bot className="h-4 w-4" />
    default: return <Activity className="h-4 w-4" />
  }
}

function getEventIconClass(source: string): string {
  switch (source) {
    case 'system': return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'
    case 'user': return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300'
    case 'agent': return 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300'
    default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
  }
}

function getEventKindClass(kind: string | undefined): string {
  if (!kind) return 'text-gray-600 dark:text-gray-400'
  switch (kind) {
    case 'AgentStartEvent': return 'text-blue-600 dark:text-blue-400'
    case 'AgentStepEvent': return 'text-green-600 dark:text-green-400'
    case 'ActionEvent': return 'text-green-600 dark:text-green-400'
    case 'ObservationEvent': return 'text-yellow-600 dark:text-yellow-400'
    default: return 'text-gray-600 dark:text-gray-400'
  }
}

// Helper to convert unknown to string
function toString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

// Extract content fields from event for display
function getEventContent(event: Event): { thought?: string; action?: string; observation?: string; content?: string; error?: string } {
  // Handle AgentStepEvent or ActionEvent - thought can be string, array, or object with text
  if (event.thought) {
    const thoughtValue = event.thought
    let thoughtText = ''
    
    if (Array.isArray(thoughtValue)) {
      thoughtText = thoughtValue.map(t => toString(t)).join('\n')
    } else if (typeof thoughtValue === 'object' && thoughtValue !== null && 'text' in thoughtValue) {
      thoughtText = toString((thoughtValue as { text: unknown }).text)
    } else {
      thoughtText = toString(thoughtValue)
    }
    return { thought: thoughtText }
  }
  
  // Handle action field
  if (event.action) {
    return { action: toString(event.action) }
  }
  
  // Handle observation field  
  if ('observation' in event && event.observation) {
    const obs = event.observation as Record<string, unknown>
    if (obs.error) {
      return { error: toString(obs.error) }
    }
    return { observation: toString(event.observation) }
  }
  
  // Handle content field
  if (event.content) {
    return { content: toString(event.content) }
  }
  
  // Handle system_prompt (for AgentStartEvent)
  if ('system_prompt' in event && event.system_prompt) {
    const sp = event.system_prompt as { text?: unknown }
    return { content: toString(sp.text) }
  }
  
  return {}
}

export default function App() {
  const [trajectories, setTrajectories] = useState<Trajectory[]>([])
  const [selectedTrajectory, setSelectedTrajectory] = useState<Trajectory | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [status, setStatus] = useState<{ staticMode: boolean; is_custom_dir: boolean; directory_name: string } | null>(null)
  const [showStatsDialog, setShowStatsDialog] = useState(false)

  // Fetch status
  const fetchStatus = useCallback(async () => {
    const config = window.TRAJECTORY_CONFIG
    if (config?.staticMode) {
      setStatus({
        staticMode: true,
        is_custom_dir: config.isCustomDir,
        directory_name: config.directoryName
      })
      return
    }
    try {
      const response = await fetch('/api/status')
      const data = await response.json()
      setStatus(data)
    } catch {
      setStatus({ staticMode: true, is_custom_dir: false, directory_name: 'OpenHands' })
    }
  }, [])

  // Fetch trajectories
  const fetchTrajectories = useCallback(async () => {
    const config = window.TRAJECTORY_CONFIG
    let url = '/api/trajectories'
    if (config?.staticMode) {
      url = 'data/trajectories.json'
    }
    try {
      const response = await fetch(url)
      return await response.json()
    } catch {
      return []
    }
  }, [])

  // Fetch events for a trajectory
  const fetchEvents = useCallback(async (trajectoryId: string) => {
    const config = window.TRAJECTORY_CONFIG
    let url = `/api/trajectories/${trajectoryId}/events`
    if (config?.staticMode) {
      url = `data/${trajectoryId}/events.json`
    }
    try {
      const response = await fetch(url)
      return await response.json()
    } catch {
      return []
    }
  }, [])

  // Calculate model stats
  const calculateModelStats = useCallback((): ModelStats[] => {
    const modelStats: Record<string, { conversations: number; totalAvgTurnTime: number; maxTurnTime: number; totalPromptTokens: number; totalCompletionTokens: number }> = {}
    
    trajectories.forEach(trajectory => {
      if (!trajectory.model) return
      
      if (!modelStats[trajectory.model]) {
        modelStats[trajectory.model] = {
          conversations: 0,
          totalAvgTurnTime: 0,
          maxTurnTime: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0
        }
      }
      
      const stats = modelStats[trajectory.model]
      stats.conversations++
      stats.totalAvgTurnTime += trajectory.avgAgentTurnTime
      if (trajectory.avgAgentTurnTime > stats.maxTurnTime) {
        stats.maxTurnTime = trajectory.avgAgentTurnTime
      }
      stats.totalPromptTokens += trajectory.promptTokens
      stats.totalCompletionTokens += trajectory.completionTokens
    })

    return Object.entries(modelStats).map(([model, stats]) => ({
      model,
      conversations: stats.conversations,
      avgTurnDuration: stats.totalAvgTurnTime / stats.conversations,
      maxTurnDuration: stats.maxTurnTime,
      totalPromptTokens: stats.totalPromptTokens,
      totalCompletionTokens: stats.totalCompletionTokens
    })).sort((a, b) => b.conversations - a.conversations)
  }, [trajectories])

  // Initialize
  useEffect(() => {
    const init = async () => {
      await fetchStatus()
      const data = await fetchTrajectories()
      setTrajectories(data)
      setIsLoading(false)

      // Check URL hash for selected trajectory
      const hashId = window.location.hash.slice(1)
      if (hashId) {
        const trajectory = data.find((t: Trajectory) => t.id === hashId)
        if (trajectory) {
          selectTrajectory(trajectory)
        }
      }
    }
    init()
  }, [fetchStatus, fetchTrajectories])

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = async () => {
      const hashId = window.location.hash.slice(1)
      if (hashId) {
        const trajectory = trajectories.find(t => t.id === hashId)
        if (trajectory && selectedTrajectory?.id !== hashId) {
          await selectTrajectory(trajectory)
        }
      } else {
        setSelectedTrajectory(null)
        setEvents([])
        setExpandedEvents(new Set())
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [trajectories, selectedTrajectory])

  // Select trajectory
  const selectTrajectory = async (trajectory: Trajectory) => {
    setSelectedTrajectory(trajectory)
    window.location.hash = trajectory.id
    const eventsData = await fetchEvents(trajectory.id)
    setEvents(eventsData)
    setExpandedEvents(new Set())
  }

  // Toggle event expansion
  const toggleEvent = (eventId: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  // Expand all events
  const expandAll = () => {
    setExpandedEvents(new Set(events.map(e => e.id)))
  }

  // Collapse all events
  const collapseAll = () => {
    setExpandedEvents(new Set())
  }

  const isCustomDir = status?.is_custom_dir

  // Helper to get sidebar classes
  const sidebarClass = cn(
    "w-80 flex flex-col border-r",
    isCustomDir 
      ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800" 
      : "bg-slate-900 dark:bg-slate-950 border-slate-700"
  )

  const sidebarHeaderClass = cn(
    "p-5 border-b",
    isCustomDir 
      ? "bg-yellow-100 dark:bg-yellow-900 border-yellow-200 dark:border-yellow-800" 
      : "bg-slate-800 dark:bg-slate-900 border-slate-700"
  )

  const sidebarTextClass = isCustomDir ? "text-black dark:text-black" : "text-white"
  const sidebarMutedClass = isCustomDir ? "text-black/70 dark:text-black/70" : "text-slate-400"

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className={sidebarClass}>
        <div className={sidebarHeaderClass}>
          <h1 className={cn("text-lg font-semibold mb-1", sidebarTextClass)}>
            Trajectory Visualizer
          </h1>
          <p className={cn("text-xs", sidebarMutedClass)}>
            {status?.directory_name || 'OpenHands'}
          </p>
        </div>

        <ScrollArea className="flex-1 p-3">
          {trajectories.length === 0 ? (
            <div className={cn(
              "text-center py-8 text-sm",
              isCustomDir ? "text-black/60 dark:text-black/60" : "text-slate-400"
            )}>
              No trajectories found
            </div>
          ) : (
            <div className="space-y-2">
              {trajectories.map(trajectory => (
                <div
                  key={trajectory.id}
                  onClick={() => selectTrajectory(trajectory)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-all border",
                    isCustomDir 
                      ? "bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 border-yellow-200 dark:border-yellow-800"
                      : "bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 border-transparent hover:border-slate-600",
                    selectedTrajectory?.id === trajectory.id && (isCustomDir 
                      ? "border-slate-400 bg-yellow-200 dark:bg-yellow-900/50"
                      : "border-slate-500 bg-slate-700 dark:bg-slate-700"
                    )
                  )}
                >
                  <div className={cn(
                    "font-mono text-xs mb-1 break-all",
                    isCustomDir ? "text-black/60 dark:text-black/60" : "text-slate-400"
                  )}>
                    {trajectory.id}
                  </div>
                  <div className={cn(
                    "text-sm font-medium mb-1",
                    sidebarTextClass
                  )}>
                    {trajectory.title}
                  </div>
                  <div className={cn(
                    "text-xs flex gap-3",
                    isCustomDir ? "text-black/60 dark:text-black/60" : "text-slate-500"
                  )}>
                    <span>{trajectory.eventCount} events</span>
                    {trajectory.model && <span>{trajectory.model}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="p-3 border-t border-slate-700">
          <Button
            onClick={() => setShowStatsDialog(true)}
            className={cn(
              "w-full text-xs",
              isCustomDir 
                ? "bg-yellow-500 hover:bg-yellow-600 text-black" 
                : "bg-slate-700 hover:bg-slate-600 text-white"
            )}
          >
            📊 Model Statistics
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b bg-card">
          <div className="flex flex-col gap-3 w-full">
            <h2 className="text-base font-semibold">
              {selectedTrajectory ? selectedTrajectory.title : 'Select a trajectory'}
            </h2>
            {selectedTrajectory && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={expandAll}>
                  Expand All
                </Button>
                <Button variant="outline" size="sm" onClick={collapseAll}>
                  Collapse All
                </Button>
              </div>
            )}
          </div>
          <ThemeToggle />
        </header>

        {/* Body */}
        <ScrollArea className="flex-1 p-6">
          {!selectedTrajectory ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <FileText className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-sm">Select a trajectory from the sidebar to view details</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-3">
              {events.map((event) => {
                const isExpanded = expandedEvents.has(event.id)
                const { time, date } = formatTimestamp(event.timestamp)
                
                return (
                  <Card key={event.id} className={cn(
                    "transition-shadow hover:shadow-md",
                    event.source === 'error' && "border-destructive"
                  )}>
                    <CardContent className="p-0">
                      <div
                        onClick={() => toggleEvent(event.id)}
                        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/50"
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                          getEventIconClass(event.source)
                        )}>
                          {getEventIcon(event.source)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={cn(
                            "text-xs font-semibold tracking-wide mb-0.5",
                            getEventKindClass(event.kind)
                          )}>
                            {event.kind?.toUpperCase() || event.source.toUpperCase()}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span className="font-mono font-medium text-primary">{time}</span>
                            <span>{date}</span>
                            {event.duration && (
                              <span className="text-green-600 font-mono font-medium ml-2">
                                +{formatTime(event.duration)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className={cn(
                          "w-6 h-6 flex items-center justify-center text-muted-foreground transition-transform",
                          isExpanded && "rotate-90"
                        )}>
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                      
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-0 space-y-3">
                          {(() => {
                            const content = getEventContent(event)
                            return (
                              <>
                                {content.thought && (
                                  <div className="bg-muted rounded-lg p-4">
                                    <div className="text-xs font-semibold text-muted-foreground mb-2">THOUGHT</div>
                                    <pre className="text-xs whitespace-pre-wrap font-mono">{content.thought}</pre>
                                  </div>
                                )}
                                {content.action && (
                                  <div className="bg-muted rounded-lg p-4">
                                    <div className="text-xs font-semibold text-muted-foreground mb-2">ACTION</div>
                                    <pre className="text-xs whitespace-pre-wrap font-mono">{content.action}</pre>
                                  </div>
                                )}
                                {content.observation && (
                                  <div className="bg-muted rounded-lg p-4">
                                    <div className="text-xs font-semibold text-muted-foreground mb-2">OBSERVATION</div>
                                    <pre className="text-xs whitespace-pre-wrap font-mono">{content.observation}</pre>
                                  </div>
                                )}
                                {content.content && (
                                  <div className="bg-muted rounded-lg p-4">
                                    <div className="text-xs font-semibold text-muted-foreground mb-2">CONTENT</div>
                                    <pre className="text-xs whitespace-pre-wrap font-mono">{content.content}</pre>
                                  </div>
                                )}
                                {content.error && (
                                  <div className="bg-destructive/10 rounded-lg p-4 border border-destructive">
                                    <div className="text-xs font-semibold text-destructive mb-2">ERROR</div>
                                    <pre className="text-xs whitespace-pre-wrap font-mono text-destructive">{content.error}</pre>
                                  </div>
                                )}
                              </>
                            )
                          })()}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </main>

      {/* Stats Dialog */}
      <Dialog open={showStatsDialog} onOpenChange={setShowStatsDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>📊 Model Statistics</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {trajectories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No data available
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-semibold text-sm">Model Name</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Conversations</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Avg Turn Duration</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Max Turn Duration</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Input Tokens</th>
                    <th className="text-left py-3 px-4 font-semibold text-sm">Completion Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {calculateModelStats().map((stats) => (
                    <tr key={stats.model} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4 font-medium text-primary">{stats.model}</td>
                      <td className="py-3 px-4 font-mono">{stats.conversations}</td>
                      <td className="py-3 px-4 font-mono">{formatTime(stats.avgTurnDuration)}</td>
                      <td className="py-3 px-4 font-mono">{formatTime(stats.maxTurnDuration)}</td>
                      <td className="py-3 px-4 font-mono">{formatTokens(stats.totalPromptTokens)}</td>
                      <td className="py-3 px-4 font-mono">{formatTokens(stats.totalCompletionTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
