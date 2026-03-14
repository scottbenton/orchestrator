import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export function TestPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-bold">Test Route</h1>
      <p className="text-muted-foreground">TanStack Router is working.</p>
      <Button variant="outline" asChild>
        <Link to="/">Back to Home</Link>
      </Button>
    </div>
  );
}
