"use client";
import React, { useMemo, useRef, useState } from "react";

export default function NBidConsole({ defaultWebhookUrl = "/api/n8n-proxy" }) {
  const webhookUrl = defaultWebhookUrl; // fixed as proxy
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [responses, setResponses] = useState([]);
  const [activeTab, setActiveTab] = useState("pretty");

  // Added: logs state
  const [showLogs, setShowLogs] = useState(true);
  const [netLog, setNetLog] = useState("");
  const [liveLog, setLiveLog] = useState("");

  const t0Ref = useRef(0);
  const companyRef = useRef(null);
  const rfpRef = useRef(null);
  const promptRef = useRef(null);

  const logNet = (line) => {
    setNetLog((prev) => prev + (prev ? "\n" : "") + line);
  };

  function tryParseJSON(text) {
    try {
      const obj = JSON.parse(text);
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  function normaliseChatPayload(result) {
    const out = [];
    const pushMsg = (content) => {
      if (content == null) return;
      if (typeof content === "object") {
        if (content.message || content.Message) {
          out.push({
            role: "assistant",
            content: String(content.message ?? content.Message),
            parsed: content,
          });
        } else if (content.text || content.output) {
          const body = content.text ?? content.output;
          const parsed = typeof body === "string" ? tryParseJSON(body) : body;
          out.push({
            role: "assistant",
            content:
              typeof body === "string" ? body : JSON.stringify(body, null, 2),
            parsed: parsed ?? content,
          });
        } else {
          out.push({
            role: "assistant",
            content: JSON.stringify(content, null, 2),
            parsed: content,
          });
        }
      } else {
        const parsed = typeof content === "string" ? tryParseJSON(content) : null;
        out.push({ role: "assistant", content: String(content), parsed });
      }
    };

    const flattenAny = (x) => {
      if (Array.isArray(x)) x.forEach(flattenAny);
      else if (x && typeof x === "object") {
        if ("message" in x || "Message" in x || "text" in x || "output" in x)
          pushMsg(x);
        else if ("data" in x) flattenAny(x.data);
        else if ("items" in x) flattenAny(x.items);
        else if ("messages" in x) flattenAny(x.messages);
        else pushMsg(x);
      } else pushMsg(x);
    };

    flattenAny(result);
    return out;
  }

  async function runWorkflow(e) {
    e?.preventDefault?.();
    setError("");
    setResponses([]);
    setNetLog("");
    setLiveLog("");
    t0Ref.current = performance.now();

    const fd = new FormData();
    const company = companyRef.current?.files?.[0] || null;
    const rfp = rfpRef.current?.files?.[0] || null;
    const prompt = promptRef.current?.value?.trim() || "Run compliance + writers";
    if (company) fd.append("company.pdf", company, company.name);
    if (rfp) fd.append("rfp.pdf", rfp, rfp.name);
    fd.append("message", prompt);

    setLoading(true);
    try {
      logNet("Preparing request...");
      const reqUrl = showLogs ? `${webhookUrl}?stream=1` : webhookUrl;

      const tSend = performance.now();
      logNet(`POST ${reqUrl}`);
      const res = await fetch(reqUrl, { method: "POST", body: fd, cache: "no-store" });
      const tHeaders = performance.now();
      logNet(`Status: ${res.status} ${res.statusText}`);
      logNet(`Headers received in ${(tHeaders - tSend).toFixed(0)} ms`);

      const contentType = res.headers.get("content-type") || "";
      let accumulated = "";

      if (showLogs && res.body) {
        // Streamed reading
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value?.length || 0;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          setLiveLog((prev) => prev + chunk);
          logNet(`+${value.length} bytes (total ${bytes})`);
        }
        logNet("Stream finished.");
      } else {
        // Non-streamed: read all at once
        if (contentType.includes("application/json")) {
          const data = await res.json();
          accumulated = JSON.stringify(data);
        } else {
          accumulated = await res.text();
        }
      }

      // Parse and display
      const maybeJSON = tryParseJSON(accumulated);
      const data = maybeJSON ?? { message: accumulated };
      const messages = normaliseChatPayload(data);
      setResponses(messages.map((m, i) => ({ id: i + 1, ...m })));

      const tDone = performance.now();
      logNet(`Total ${(tDone - t0Ref.current).toFixed(0)} ms`);
      if (!contentType) logNet("Note: upstream did not set content-type; parsed as text.");
    } catch (err) {
      setError(err?.message || String(err));
      logNet(`Error: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  const hasCompliance = useMemo(() => {
    for (const r of responses) {
      const p = r.parsed;
      if (p && ("compliant" in p || "Compliant" in p) && ("message" in p || "Message" in p)) {
        return {
          compliant: Boolean(p.compliant ?? p.Compliant),
          message: String(p.message ?? p.Message ?? r.content),
        };
      }
    }
    return null;
  }, [responses]);

  const writers = useMemo(() => {
    const buckets = { executive: [], technical: [], pricing: [], references: [], timeline: [], other: [] };
    for (const r of responses) {
      const text = r.content.toLowerCase();
      if (text.includes("executive summary")) buckets.executive.push(r);
      else if (text.includes("technical") || text.includes("architecture")) buckets.technical.push(r);
      else if (text.includes("pricing")) buckets.pricing.push(r);
      else if (text.includes("reference")) buckets.references.push(r);
      else if (text.includes("timeline") || text.includes("phase")) buckets.timeline.push(r);
      else buckets.other.push(r);
    }
    return buckets;
  }, [responses]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">n8n Bid Console</h1>
        <p className="text-sm opacity-80">
          Upload two PDFs and watch live logs while the workflow runs.
        </p>
      </header>

      <form onSubmit={runWorkflow} className="space-y-4 bg-white/5 p-4 rounded-2xl border border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <input
              id="logs"
              type="checkbox"
              checked={showLogs}
              onChange={(e) => setShowLogs(e.target.checked)}
            />
            <label htmlFor="logs">Show logs (stream)</label>
          </div>
          {loading && <span className="text-sm opacity-70 animate-pulse">Running…</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm">Company Profile PDF</span>
            <input ref={companyRef} type="file" accept="application/pdf" className="mt-1 block w-full"/>
          </label>
          <label className="block">
            <span className="text-sm">RFP PDF</span>
            <input ref={rfpRef} type="file" accept="application/pdf" className="mt-1 block w-full"/>
          </label>
        </div>

        <label className="block">
          <span className="text-sm">Message (optional)</span>
          <input ref={promptRef} type="text" className="mt-1 w-full rounded-xl border border-white/20 bg-transparent p-2" defaultValue="Run compliance + writers" />
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-xl px-4 py-2 bg-white/10 border border-white/20 hover:bg-white/20">Run workflow</button>
          {error && <span className="text-red-400 text-sm">{error}</span>}
        </div>
      </form>

      {/* Added: network log + live response */}
      <section className="mt-6 grid md:grid-cols-2 gap-4">
        <div className="border border-white/10 rounded-2xl p-3">
          <h3 className="font-semibold mb-2 text-sm">Network log</h3>
          <pre className="text-xs bg-black/50 rounded p-2 min-h-[6rem] whitespace-pre-wrap">{netLog || "—"}</pre>
        </div>
        <div className="border border-white/10 rounded-2xl p-3">
          <h3 className="font-semibold mb-2 text-sm">Live response</h3>
          <pre className="text-xs bg-black/50 rounded p-2 min-h-[6rem] overflow-auto max-h-64 whitespace-pre-wrap">{liveLog || "—"}</pre>
        </div>
      </section>

      {hasCompliance && (
        <section className="mt-6 border border-white/10 rounded-2xl p-4">
          <h2 className="font-semibold mb-2">Compliance</h2>
          <div className={`text-sm rounded-xl p-3 ${hasCompliance.compliant ? "bg-emerald-500/10 border border-emerald-600" : "bg-amber-500/10 border border-amber-600"}`}>
            <div className="font-medium mb-1">{hasCompliance.compliant ? "Compliant ✅" : "Not compliant ❌"}</div>
            <p className="whitespace-pre-wrap">{hasCompliance.message}</p>
          </div>
        </section>
      )}

      {responses.length > 0 && (
        <section className="mt-6 border border-white/10 rounded-2xl p-4">
          <div className="flex gap-2 mb-4 text-sm">
            {[["pretty","Writers view"],["stream","All messages"],["raw","Raw"],["logs","Logs"]].map(([k,label]) => (
              <button key={k} onClick={(e)=>{e.preventDefault();setActiveTab(k);}} className={`px-3 py-1 rounded-lg border ${activeTab===k?"bg-white/10 border-white/30":"border-white/10"}`}>{label}</button>
            ))}
          </div>

          {activeTab==="pretty" && (
            <div className="grid md:grid-cols-2 gap-4">
              {Object.entries(writers).map(([bucket, items]) => (
                <div key={bucket} className="border border-white/10 rounded-xl p-3">
                  <h3 className="font-semibold mb-1 capitalize">{bucket}</h3>
                  {items.length===0 ? <p className="text-sm opacity-60">No content</p> : (
                    <ul className="space-y-2 text-sm">{items.map((r)=>(
                      <li key={r.id} className="bg-white/5 rounded p-2 whitespace-pre-wrap">{r.content}</li>
                    ))}</ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab==="stream" && (
            <div className="space-y-3">{responses.map((r)=> (
              <div key={r.id} className="bg-white/5 rounded-xl p-3">
                <div className="text-xs opacity-70 mb-1">#{r.id}</div>
                <div className="whitespace-pre-wrap text-sm">{r.content}</div>
              </div>
            ))}</div>
          )}

          {activeTab==="raw" && (
            <pre className="text-xs bg-black/60 rounded-xl p-3 overflow-auto max-h-96">{JSON.stringify(responses.map(r=> r.parsed ?? r.content), null, 2)}</pre>
          )}

          {activeTab==="logs" && (
            <div className="grid md:grid-cols-2 gap-4">
              <pre className="text-xs bg-black/60 rounded-xl p-3 overflow-auto max-h-96 whitespace-pre-wrap">{netLog || "—"}</pre>
              <pre className="text-xs bg-black/60 rounded-xl p-3 overflow-auto max-h-96 whitespace-pre-wrap">{liveLog || "—"}</pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
