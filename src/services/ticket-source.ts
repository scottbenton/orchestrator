import type { RepoSettings } from "@/types/config";
import type { Task } from "@/types/task";

export interface TicketSource {
	fetchTasks(repoSettings: RepoSettings): Promise<Task[]>;
	transitionTask(taskId: string, status: string): Promise<void>;
}
