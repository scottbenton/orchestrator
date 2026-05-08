export interface Task {
	id: string;
	title: string;
	description: string;
	labels: string[];
	grouping?: {
		id: string;
		label: string;
	};
	url: string;
	provider: string;
	sourceIssueNumber?: number;
}
