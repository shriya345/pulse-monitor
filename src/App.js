import { useState, useEffect, useRef, useCallback } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
// ─── Palette & Theme ────────────────────────────────────────────────────────
const COLORS = {
  bg: "#0a0d14",
  surface: "#111520",
  card: "#161c2e",
  border: "#1e2840",
  accent: "#00e5ff",
  accentDim: "#00e5ff22",
  green: "#00ff88",
  greenDim: "#00ff8820",
  red: "#ff3c5f",
  redDim: "#ff3c5f20",
  yellow: "#ffbb00",
  yellowDim: "#ffbb0020",
  purple: "#bd00ff",
  text: "#e8eaf6",
  textMuted: "#5a6a8a",
  textDim: "#8892aa",
  grid: "#1a2035",
};

// ─── Simulated Endpoints ─────────────────────────────────────────────────────
const DEFAULT_MONITORS = [
  { id: 1, name: "GitHub API", url: "https://api.github.com", interval: 30, threshold: 3, enabled: true },
  { id: 2, name: "JSONPlaceholder", url: "https://jsonplaceholder.typicode.com/posts/1", interval: 20, threshold: 2, enabled: true },
  { id: 3, name: "OpenWeather", url: "https://api.openweathermap.org/data/2.5/weather", interval: 60, threshold: 3, enabled: true },
  { id: 4, name: "Stripe API", url: "https://api.stripe.com/v1/charges", interval: 45, threshold: 2, enabled: true },
  { id: 5, name: "Twilio API", url: "https://api.twilio.com/2010-04-01", interval: 60, threshold: 3, enabled: false },
];

// ─── Simulation Engine ───────────────────────────────────────────────────────
function simulateCheck(monitor, tick) {
  // Inject occasional failures and latency spikes
  const failureWindows = {
    3: tick > 8 && tick < 14,    // OpenWeather goes down
    4: tick > 20 && tick < 23,   // Stripe brief outage
    2: tick === 15 || tick === 30, // JSONPlaceholder flaps
  };

  const isDown = failureWindows[monitor.id] || (Math.random() < 0.04);
  const baseLatency = { 1: 120, 2: 45, 3: 280, 4: 190, 5: 310 }[monitor.id] || 150;
  const latency = isDown ? 0 : Math.round(baseLatency + (Math.random() - 0.5) * baseLatency * 0.6);
  const statusCode = isDown ? (Math.random() > 0.5 ? 503 : 0) : 200;

  return {
    timestamp: Date.now(),
    isUp: !isDown,
    latency,
    statusCode,
    tick,
  };
}

function calcUptimePct(logs) {
  if (!logs.length) return 100;
  return Math.round((logs.filter(l => l.isUp).length / logs.length) * 1000) / 10;
}

function calcP95(logs) {
  const latencies = logs.filter(l => l.isUp && l.latency > 0).map(l => l.latency).sort((a, b) => a - b);
  if (!latencies.length) return 0;
  return latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1];
}

// ─── AI Incident Analyzer ─────────────────────────────────────────────────────
async function analyzeIncidentWithClaude(monitor, logs, incidents) {
  const recentLogs = logs.slice(-10);
  const context = {
    endpoint: monitor.url,
    name: monitor.name,
    recentChecks: recentLogs.map(l => ({ up: l.isUp, latency: l.latency, status: l.statusCode })),
    uptimePct: calcUptimePct(logs),
    p95: calcP95(logs),
    incidentCount: incidents.length,
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are an SRE incident analysis AI. Analyze this API health data and provide a concise incident report.

Monitor: ${context.name} (${context.endpoint})
Uptime: ${context.uptimePct}%
P95 Latency: ${context.p95}ms
Total Incidents: ${context.incidentCount}
Recent checks (last 10): ${JSON.stringify(context.recentChecks)}

Respond with a JSON object (no markdown, just raw JSON) with these fields:
{
  "severity": "critical|high|medium|low",
  "rootCause": "brief likely root cause (1 sentence)",
  "impact": "brief user impact description (1 sentence)",
  "recommendation": "top actionable recommendation (1 sentence)",
  "estimatedResolution": "estimated time to resolve",
  "affectedUsers": "estimated % of users affected"
}`
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { severity: "unknown", rootCause: text, recommendation: "Check logs manually." };
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge = ({ isUp, size = "sm" }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: size === "sm" ? "2px 8px" : "4px 12px",
    borderRadius: 4,
    fontSize: size === "sm" ? 11 : 13,
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700,
    letterSpacing: "0.05em",
    background: isUp ? COLORS.greenDim : COLORS.redDim,
    color: isUp ? COLORS.green : COLORS.red,
    border: `1px solid ${isUp ? COLORS.green + "40" : COLORS.red + "40"}`,
  }}>
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: isUp ? COLORS.green : COLORS.red, boxShadow: `0 0 6px ${isUp ? COLORS.green : COLORS.red}` }} />
    {isUp ? "OPERATIONAL" : "DOWN"}
  </span>
);

const MetricCard = ({ label, value, unit, color, sub }) => (
  <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "16px 20px", flex: 1, minWidth: 130 }}>
    <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.15em", fontFamily: "'JetBrains Mono', monospace", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
    <div style={{ fontSize: 28, fontFamily: "'Space Mono', monospace", fontWeight: 700, color: color || COLORS.accent, lineHeight: 1 }}>
      {value}<span style={{ fontSize: 13, marginLeft: 3, color: COLORS.textMuted }}>{unit}</span>
    </div>
    {sub && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
  </div>
);

const UptimeBar = ({ logs }) => {
  const bars = logs.slice(-60);
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 24 }}>
      {Array.from({ length: 60 }, (_, i) => {
        const log = bars[i];
        if (!log) return <div key={i} style={{ width: 4, height: 8, background: COLORS.border, borderRadius: 2 }} />;
        return <div key={i} style={{ width: 4, height: log.isUp ? 20 : 8, background: log.isUp ? COLORS.green : COLORS.red, borderRadius: 2, opacity: 0.8 }} />;
      })}
    </div>
  );
};

const SeverityBadge = ({ severity }) => {
  const map = { critical: [COLORS.red, "CRITICAL"], high: [COLORS.yellow, "HIGH"], medium: [COLORS.accent, "MEDIUM"], low: [COLORS.green, "LOW"], unknown: [COLORS.textMuted, "UNKNOWN"] };
  const [color, label] = map[severity] || map.unknown;
  return (
    <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", background: color + "22", color, border: `1px solid ${color}44` }}>
      {label}
    </span>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [monitors, setMonitors] = useState(DEFAULT_MONITORS);
  const [logs, setLogs] = useState({});           // { monitorId: [{...}] }
  const [incidents, setIncidents] = useState({}); // { monitorId: [{...}] }
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("dashboard");  // dashboard | incidents | add
  const [aiAnalysis, setAiAnalysis] = useState({});
  const [aiLoading, setAiLoading] = useState({});
  const [tick, setTick] = useState(0);
  const [addForm, setAddForm] = useState({ name: "", url: "", interval: 30, threshold: 3 });
  const [globalAlerts, setGlobalAlerts] = useState([]);
  const tickRef = useRef(0);
  const intervalRef = useRef(null);

  // ── Polling Engine ───────────────────────────────────────────────────────
  const runChecks = useCallback(() => {
    tickRef.current += 1;
    const t = tickRef.current;
    setTick(t);

    setMonitors(prev => prev.map(m => {
      if (!m.enabled) return m;
      const result = simulateCheck(m, t);

      setLogs(prevLogs => {
        const existing = prevLogs[m.id] || [];
        const updated = [...existing, { ...result, id: Date.now() + m.id }].slice(-120);

        // Incident detection: 3+ consecutive failures
        const recent = updated.slice(-m.threshold);
        const allDown = recent.length >= m.threshold && recent.every(l => !l.isUp);

        if (allDown) {
          setIncidents(prevInc => {
            const existing2 = prevInc[m.id] || [];
            const lastInc = existing2[existing2.length - 1];
            if (!lastInc || lastInc.resolved) {
              const newInc = { id: Date.now(), monitorId: m.id, monitorName: m.name, startedAt: Date.now(), resolved: false, checks: m.threshold };
              // Alert
              setGlobalAlerts(a => [{ id: Date.now(), type: "down", name: m.name, time: Date.now() }, ...a].slice(0, 10));
              return { ...prevInc, [m.id]: [...existing2, newInc] };
            }
            return prevInc;
          });
        }

        // Auto-resolve
        if (result.isUp) {
          setIncidents(prevInc => {
            const existing2 = prevInc[m.id] || [];
            const hasOpen = existing2.some(i => !i.resolved);
            if (hasOpen) {
              setGlobalAlerts(a => [{ id: Date.now(), type: "recovered", name: m.name, time: Date.now() }, ...a].slice(0, 10));
            }
            return {
              ...prevInc,
              [m.id]: existing2.map(i => !i.resolved ? { ...i, resolved: true, resolvedAt: Date.now() } : i)
            };
          });
        }

        return { ...prevLogs, [m.id]: updated };
      });

      return { ...m, lastCheck: result };
    }));
  }, []);

  useEffect(() => {
    runChecks();
    intervalRef.current = setInterval(runChecks, 3000);
    return () => clearInterval(intervalRef.current);
  }, [runChecks]);

  // ── AI Analysis ───────────────────────────────────────────────────────────
  const triggerAiAnalysis = async (monitor) => {
    const monLogs = logs[monitor.id] || [];
    const monIncs = incidents[monitor.id] || [];
    if (monLogs.length < 3) return;
    setAiLoading(p => ({ ...p, [monitor.id]: true }));
    try {
      const analysis = await analyzeIncidentWithClaude(monitor, monLogs, monIncs);
      setAiAnalysis(p => ({ ...p, [monitor.id]: { ...analysis, generatedAt: Date.now() } }));
    } catch (e) {
      setAiAnalysis(p => ({ ...p, [monitor.id]: { severity: "unknown", rootCause: "AI analysis failed — check API key.", recommendation: "Review logs manually." } }));
    }
    setAiLoading(p => ({ ...p, [monitor.id]: false }));
  };

  // ── Add Monitor ───────────────────────────────────────────────────────────
  const addMonitor = () => {
    if (!addForm.name || !addForm.url) return;
    const newM = { id: Date.now(), ...addForm, enabled: true };
    setMonitors(p => [...p, newM]);
    setAddForm({ name: "", url: "", interval: 30, threshold: 3 });
    setView("dashboard");
  };

  // ── Derived stats ─────────────────────────────────────────────────────────
  const enabledMonitors = monitors.filter(m => m.enabled);
  const totalDown = enabledMonitors.filter(m => m.lastCheck && !m.lastCheck.isUp).length;
  const openIncidents = Object.values(incidents).flat().filter(i => !i.resolved).length;
  const avgUptime = enabledMonitors.length
    ? Math.round(enabledMonitors.reduce((acc, m) => acc + calcUptimePct(logs[m.id] || []), 0) / enabledMonitors.length * 10) / 10
    : 100;

  const selectedMonitor = monitors.find(m => m.id === selected);
  const selectedLogs = selected ? (logs[selected] || []) : [];
  const latencyData = selectedLogs.map((l, i) => ({ i, latency: l.isUp ? l.latency : null, status: l.statusCode }));

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    app: { background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: "'Inter', sans-serif", display: "flex", flexDirection: "column" },
    topbar: { background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 },
    logo: { fontFamily: "'Space Mono', monospace", fontSize: 15, fontWeight: 700, color: COLORS.accent, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 10 },
    nav: { display: "flex", gap: 4 },
    navBtn: (active) => ({ background: active ? COLORS.accentDim : "transparent", color: active ? COLORS.accent : COLORS.textMuted, border: active ? `1px solid ${COLORS.accent}33` : "1px solid transparent", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em", transition: "all 0.15s" }),
    main: { flex: 1, padding: 24, maxWidth: 1400, margin: "0 auto", width: "100%", boxSizing: "border-box" },
    grid: { display: "grid", gridTemplateColumns: "340px 1fr", gap: 20, alignItems: "start" },
    section: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" },
    sectionHead: { padding: "14px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
    sectionTitle: { fontSize: 11, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.12em", color: COLORS.textMuted, textTransform: "uppercase" },
    monitorRow: (active, isDown) => ({
      padding: "14px 20px", cursor: "pointer", borderBottom: `1px solid ${COLORS.border}`,
      background: active ? (isDown ? COLORS.redDim : COLORS.accentDim) : "transparent",
      borderLeft: `3px solid ${active ? (isDown ? COLORS.red : COLORS.accent) : "transparent"}`,
      transition: "all 0.15s",
    }),
    btn: (color) => ({ background: color ? color + "22" : COLORS.accentDim, color: color || COLORS.accent, border: `1px solid ${(color || COLORS.accent) + "44"}`, borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }),
    input: { background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "8px 12px", color: COLORS.text, fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box", outline: "none" },
  };

  return (
    <div style={s.app}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${COLORS.bg}; } ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0.2} }
      `}</style>

      {/* Top Bar */}
      <div style={s.topbar}>
        <div style={s.logo}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: totalDown > 0 ? COLORS.red : COLORS.green, boxShadow: `0 0 10px ${totalDown > 0 ? COLORS.red : COLORS.green}`, display: "inline-block", animation: "pulse 2s infinite" }} />
          PULSE MONITOR
          <span style={{ fontSize: 10, color: COLORS.textMuted, fontWeight: 400, marginLeft: 8 }}>v2.4.1</span>
        </div>
        <div style={s.nav}>
          {[["dashboard", "DASHBOARD"], ["incidents", "INCIDENTS"], ["add", "+ ADD"]].map(([v, l]) => (
            <button key={v} style={s.navBtn(view === v)} onClick={() => setView(v)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
            TICK <span style={{ color: COLORS.accent }}>{tick}</span>
          </span>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: totalDown > 0 ? COLORS.red : COLORS.green }}>
            {totalDown > 0 ? `${totalDown} DOWN` : "ALL SYSTEMS GO"}
          </span>
        </div>
      </div>

      {/* Alert Toast Strip */}
      {globalAlerts.length > 0 && (
        <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "6px 28px", display: "flex", gap: 12, overflowX: "auto" }}>
          {globalAlerts.slice(0, 5).map(a => (
            <span key={a.id} style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: a.type === "down" ? COLORS.red : COLORS.green, whiteSpace: "nowrap", padding: "2px 10px", background: (a.type === "down" ? COLORS.red : COLORS.green) + "15", borderRadius: 4, border: `1px solid ${(a.type === "down" ? COLORS.red : COLORS.green)}33` }}>
              {a.type === "down" ? "⚠ ALERT:" : "✓ RECOVERED:"} {a.name} · {new Date(a.time).toLocaleTimeString()}
            </span>
          ))}
        </div>
      )}

      <div style={s.main}>
        {/* ── Dashboard View ── */}
        {view === "dashboard" && (
          <>
            {/* Summary Metrics */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <MetricCard label="Avg Uptime" value={avgUptime} unit="%" color={avgUptime > 99 ? COLORS.green : avgUptime > 95 ? COLORS.yellow : COLORS.red} sub="All monitors" />
              <MetricCard label="Monitors Active" value={enabledMonitors.length} unit="" color={COLORS.accent} sub={`${monitors.length} total`} />
              <MetricCard label="Services Down" value={totalDown} unit="" color={totalDown > 0 ? COLORS.red : COLORS.green} sub="Current" />
              <MetricCard label="Open Incidents" value={openIncidents} unit="" color={openIncidents > 0 ? COLORS.yellow : COLORS.green} sub="Active now" />
              <MetricCard label="Checks Run" value={tick * enabledMonitors.length} unit="" color={COLORS.purple} sub={`${tick} cycles`} />
            </div>

            <div style={s.grid}>
              {/* Monitor List */}
              <div style={s.section}>
                <div style={s.sectionHead}>
                  <span style={s.sectionTitle}>Endpoints</span>
                  <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>{enabledMonitors.length} active</span>
                </div>
                {monitors.map(m => {
                  const mLogs = logs[m.id] || [];
                  const isDown = m.lastCheck && !m.lastCheck.isUp;
                  const uptime = calcUptimePct(mLogs);
                  const p95 = calcP95(mLogs);
                  const hasOpenInc = (incidents[m.id] || []).some(i => !i.resolved);

                  return (
                    <div key={m.id} style={s.monitorRow(selected === m.id, isDown)} onClick={() => setSelected(m.id === selected ? null : m.id)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: isDown ? COLORS.red : COLORS.text, display: "flex", alignItems: "center", gap: 6 }}>
                            {m.name}
                            {hasOpenInc && <span style={{ fontSize: 9, background: COLORS.redDim, color: COLORS.red, padding: "1px 5px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace" }}>INC</span>}
                          </div>
                          <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{m.url}</div>
                        </div>
                        {m.enabled ? <StatusBadge isUp={!isDown} /> : <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>PAUSED</span>}
                      </div>
                      <div style={{ display: "flex", gap: 16 }}>
                        <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>UP <span style={{ color: uptime > 99 ? COLORS.green : uptime > 95 ? COLORS.yellow : COLORS.red }}>{uptime}%</span></span>
                        <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>P95 <span style={{ color: COLORS.accent }}>{p95}ms</span></span>
                        <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                          {m.lastCheck ? `${m.lastCheck.latency || "—"}ms` : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Detail Panel */}
              <div>
                {selectedMonitor ? (
                  <>
                    {/* Header */}
                    <div style={{ ...s.section, marginBottom: 16 }}>
                      <div style={{ padding: "20px 24px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                          <div>
                            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{selectedMonitor.name}</div>
                            <div style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>{selectedMonitor.url}</div>
                          </div>
                          <StatusBadge isUp={selectedMonitor.lastCheck?.isUp ?? true} size="lg" />
                        </div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <MetricCard label="Uptime" value={calcUptimePct(selectedLogs)} unit="%" color={calcUptimePct(selectedLogs) > 99 ? COLORS.green : COLORS.yellow} />
                          <MetricCard label="P95 Latency" value={calcP95(selectedLogs)} unit="ms" color={COLORS.accent} />
                          <MetricCard label="Last Status" value={selectedMonitor.lastCheck?.statusCode || "—"} unit="" color={selectedMonitor.lastCheck?.isUp ? COLORS.green : COLORS.red} />
                          <MetricCard label="Incidents" value={(incidents[selected] || []).length} unit="" color={COLORS.yellow} />
                        </div>
                      </div>
                    </div>

                    {/* Uptime Bar */}
                    <div style={{ ...s.section, marginBottom: 16 }}>
                      <div style={s.sectionHead}>
                        <span style={s.sectionTitle}>60-Check History</span>
                        <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>{selectedLogs.length} checks</span>
                      </div>
                      <div style={{ padding: "14px 20px" }}>
                        <UptimeBar logs={selectedLogs} />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                          <span>OLDEST</span><span>NOW</span>
                        </div>
                      </div>
                    </div>

                    {/* Latency Chart */}
                    <div style={{ ...s.section, marginBottom: 16 }}>
                      <div style={s.sectionHead}>
                        <span style={s.sectionTitle}>Response Time (ms)</span>
                      </div>
                      <div style={{ padding: "12px 8px 8px" }}>
                        <ResponsiveContainer width="100%" height={160}>
                          <AreaChart data={latencyData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                            <defs>
                              <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                            <XAxis dataKey="i" tick={{ fill: COLORS.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} />
                            <YAxis tick={{ fill: COLORS.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} />
                            <Tooltip contentStyle={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }} labelStyle={{ color: COLORS.textMuted }} />
                            <Area type="monotone" dataKey="latency" stroke={COLORS.accent} strokeWidth={2} fill="url(#latGrad)" dot={false} isAnimationActive={false} connectNulls={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* AI Analysis */}
                    <div style={s.section}>
                      <div style={s.sectionHead}>
                        <span style={s.sectionTitle}>AI Incident Analysis</span>
                        <button style={s.btn(COLORS.purple)} onClick={() => triggerAiAnalysis(selectedMonitor)} disabled={aiLoading[selected]}>
                          {aiLoading[selected] ? "ANALYZING..." : "⚡ ANALYZE"}
                        </button>
                      </div>
                      <div style={{ padding: "16px 20px" }}>
                        {aiLoading[selected] && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, color: COLORS.purple }}>
                            <span style={{ animation: "pulse 1s infinite", fontSize: 20 }}>◈</span>
                            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>Claude is analyzing incident patterns...</span>
                          </div>
                        )}
                        {!aiLoading[selected] && aiAnalysis[selected] && (() => {
                          const a = aiAnalysis[selected];
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <SeverityBadge severity={a.severity} />
                                <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                                  {a.affectedUsers && `~${a.affectedUsers} users affected`}
                                </span>
                              </div>
                              {[["ROOT CAUSE", a.rootCause], ["IMPACT", a.impact], ["RECOMMENDATION", a.recommendation], ["EST. RESOLUTION", a.estimatedResolution]].filter(([, v]) => v).map(([label, val]) => (
                                <div key={label} style={{ background: COLORS.card, borderRadius: 6, padding: "10px 14px", border: `1px solid ${COLORS.border}` }}>
                                  <div style={{ fontSize: 9, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.12em", marginBottom: 4 }}>{label}</div>
                                  <div style={{ fontSize: 12, color: COLORS.text, lineHeight: 1.5 }}>{val}</div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {!aiLoading[selected] && !aiAnalysis[selected] && (
                          <div style={{ color: COLORS.textMuted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                            Click ANALYZE to get AI-powered incident analysis
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ ...s.section, display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
                    <div style={{ textAlign: "center", color: COLORS.textMuted }}>
                      <div style={{ fontSize: 36, marginBottom: 12 }}>◈</div>
                      <div style={{ fontSize: 14, fontFamily: "'JetBrains Mono', monospace" }}>Select a monitor to view details</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Incidents View ── */}
        {view === "incidents" && (
          <div style={s.section}>
            <div style={s.sectionHead}>
              <span style={s.sectionTitle}>Incident History</span>
              <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                {Object.values(incidents).flat().length} total
              </span>
            </div>
            {Object.values(incidents).flat().length === 0 ? (
              <div style={{ padding: 60, textAlign: "center", color: COLORS.textMuted }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>No incidents recorded yet</div>
              </div>
            ) : (
              <div>
                {Object.values(incidents).flat().sort((a, b) => b.startedAt - a.startedAt).map(inc => {
                  const duration = inc.resolved ? Math.round((inc.resolvedAt - inc.startedAt) / 1000) : Math.round((Date.now() - inc.startedAt) / 1000);
                  return (
                    <div key={inc.id} style={{ padding: "16px 24px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: inc.resolved ? COLORS.text : COLORS.red }}>{inc.monitorName}</span>
                          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", background: inc.resolved ? COLORS.greenDim : COLORS.redDim, color: inc.resolved ? COLORS.green : COLORS.red, border: `1px solid ${inc.resolved ? COLORS.green : COLORS.red}33` }}>
                            {inc.resolved ? "RESOLVED" : "ACTIVE"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                          Started: {new Date(inc.startedAt).toLocaleTimeString()} · Duration: {duration}s · Triggered after {inc.checks} failures
                        </div>
                      </div>
                      {aiAnalysis[inc.monitorId] && <SeverityBadge severity={aiAnalysis[inc.monitorId].severity} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Add Monitor View ── */}
        {view === "add" && (
          <div style={{ maxWidth: 520 }}>
            <div style={s.section}>
              <div style={s.sectionHead}><span style={s.sectionTitle}>Add New Monitor</span></div>
              <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
                {[["Name", "name", "GitHub API"], ["URL", "url", "https://api.example.com/health"]].map(([label, key, ph]) => (
                  <div key={key}>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", marginBottom: 6 }}>{label.toUpperCase()}</div>
                    <input style={s.input} placeholder={ph} value={addForm[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", marginBottom: 6 }}>CHECK INTERVAL (s)</div>
                    <input type="number" style={s.input} value={addForm.interval} min={10} max={300} onChange={e => setAddForm(f => ({ ...f, interval: +e.target.value }))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em", marginBottom: 6 }}>FAILURE THRESHOLD</div>
                    <input type="number" style={s.input} value={addForm.threshold} min={1} max={10} onChange={e => setAddForm(f => ({ ...f, threshold: +e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <button style={{ ...s.btn(), flex: 1, padding: "10px 0", fontSize: 13 }} onClick={addMonitor}>ADD MONITOR</button>
                  <button style={{ ...s.btn(COLORS.red), padding: "10px 16px" }} onClick={() => setView("dashboard")}>CANCEL</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "10px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>PULSE MONITOR · Checks every 3s · Simulated endpoints</span>
        <span style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>AI analysis powered by Claude</span>
      </div>
    </div>
  );
}
