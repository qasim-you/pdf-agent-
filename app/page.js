import Image from "next/image";
import NBidConsole from "./components/NBidConsole";

export default function Home() {
  return (
     <main className="min-h-dvh p-6">
      {/* Fixed proxy, completely not relying on NEXT_PUBLIC_* */}
      <NBidConsole defaultWebhookUrl="/api/n8n-proxy" />
      <section className="mt-8 text-xs opacity-60">
        <p>Proxy is enabled by default. Set N8N_WEBHOOK_URL in .env.local.</p>
      </section>
    </main>




  );  
}
