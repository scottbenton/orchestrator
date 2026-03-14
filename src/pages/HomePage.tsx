import { Button } from "@/components/ui/button";

export function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-4xl font-bold">Orchestrator</h1>
      <p className="text-muted-foreground">AI agent workspace manager</p>
      <Button>Get Started</Button>
    </div>
  );
}
