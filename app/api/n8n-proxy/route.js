import { NextResponse } from "next/server";

export const runtime = "edge"; // or "nodejs"; if you need Node.js packages, switch to "nodejs"

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    ...extra,
  };
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(req) {
  const webhook = process.env.N8N_WEBHOOK_URL;

  try {
    const host = webhook ? new URL(webhook).host : "(undefined)";
    console.log("[n8n-proxy] N8N_WEBHOOK_URL host =", host);
  } catch {
    // ignore
  }

  if (!webhook) {
    return NextResponse.json(
      {
        error: "Missing N8N_WEBHOOK_URL",
        hint: "Please create a .env.local file in the project root and set N8N_WEBHOOK_URL=https://<workspace>.app.n8n.cloud/ai-chat/<workflowId>, then restart the dev server.",
      },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const wantStream = url.searchParams.get("stream") === "1";

  try {
    const contentType = req.headers.get("content-type") || "";
    let body;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const out = new FormData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") out.append(k, v);
        else out.append(k, v, v.name);
      }
      body = out;
    } else if (contentType.includes("application/json")) {
      const json = await req.json();
      body = JSON.stringify(json);
    } else {
      body = await req.text();
    }

    const upstream = await fetch(webhook, {
      method: "POST",
      body,
      headers: contentType.includes("multipart/form-data")
        ? undefined
        : { "content-type": contentType },
      cache: "no-store",
    });

    const resType = upstream.headers.get("content-type") || "";

    if (wantStream) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: corsHeaders({
          "content-type": resType || "text/plain",
        }),
      });
    }

    if (resType.includes("application/json")) {
      const data = await upstream.json();
      return NextResponse.json(data, { headers: corsHeaders() });
    } else {
      const text = await upstream.text();
      return new Response(text, {
        headers: corsHeaders({ "content-type": resType || "text/plain" }),
      });
    }
  } catch (e) {
    console.error("[n8n-proxy] Error:", e);
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
