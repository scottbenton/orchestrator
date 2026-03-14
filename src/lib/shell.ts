import { Command } from "@tauri-apps/plugin-shell";

export async function runCommand(
  program: string,
  args: string[],
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const cmd = Command.create(program, args, options);
  const output = await cmd.execute();
  return {
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  };
}
